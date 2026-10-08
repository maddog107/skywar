// ═══════════════════════════════════════════════════════════════
// Sun shadows: camera-centred, stable, texel-snapped cascaded shadow maps (CSM).
//
// Each cascade is a box in light space (the plane across the sun's rays) of fixed half-size R, centred a little
// ahead of the camera along the view (on the player's jet when it's that close), its centre snapped to the
// cascade's own texel grid. Fixed sizes and snapped centres keep every shadow edge still while the camera moves
// and turns (Valient, "Stable Rendering of Cascaded Shadow Maps", ShaderX6, 2008). The sizes follow the practical
// split scheme (Zhang et al., "Parallel-Split Shadow Maps", 2006) between a few metres and the shadow distance.
//
// A fragment uses the first cascade whose box (and depth range) holds it ("map-based selection"), blending into
// the next one across a band at the box's edge, and fades to unshadowed at the edge of the last. A cascade's depth
// range covers its region of interest (and casters up to ~500 m above it, the length of an aircraft's umbra), so a
// point outside it (the ground far below a cascade hung round the jet) falls through to a coarser cascade.
//
// Every cascade is a three.js DirectionalLight with a standard shadow (light 0 is the sun and carries the light;
// the others have no light of their own), so the shadow coordinates are three's (vDirectionalShadowCoord[i]: the
// vegetation's shifted lookup and anything else that touches worldPosition keeps working) and the light / shadow
// uniforms stay standard. Cascades re-render on their own schedule (the far ones every other frame), and each
// one skips casters too small for its texels and, where safe, casters a finer cascade already holds.
//
// Filtering: tent PCF from bilinear compare taps (Castaño, "Shadow Mapping Summary", 2013); on ultra contact
// hardening (Fernando, "Percentage-Closer Soft Shadows", 2005) with a blocker search done through the compare
// sampler at a few depth offsets; receiver-plane depth bias for the wide kernels, a normal offset in the vertex.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

export const CSM_MAX = 4;
// the sun's angular radius (0.53° disc): a blocker d metres above a surface gives a penumbra d × 0.0093 across
export const SUN_TAN_RADIUS = Math.tan(0.2665 * Math.PI / 180);

// Per quality: cascades (n) between `near` and `far` (the shadow distance, m) by the practical split scheme with
// weight `lambda` on the logarithmic split; map size and update period (frames) per cascade; filter per cascade
// (0: 3×3 tent, 1: 5×5 tent, 2: contact-hardening PCSS). The cascade count is also what tells the shaders which
// filters to compile (a different NUM_DIR_LIGHT_SHADOWS is a different program), so it differs per level.
export const CSM_QUALITY = {
    low: { n: 1, near: 6, far: 140, lambda: 0.99, size: [1024], every: [1], filter: [0] },
    medium: { n: 2, near: 6, far: 1100, lambda: 0.99, size: [2048, 1024], every: [1, 3], filter: [1, 0] },
    high: { n: 3, near: 6, far: 1100, lambda: 0.99, size: [2048, 2048, 2048], every: [1, 1, 2], filter: [1, 1, 0] },
    ultra: { n: 4, near: 6, far: 2000, lambda: 0.99, size: [2048, 2048, 2048, 2048], every: [1, 1, 2, 2], filter: [2, 2, 2, 0] },
};
export const CSM_FILTERS = { 1: CSM_QUALITY.low.filter, 2: CSM_QUALITY.medium.filter, 3: CSM_QUALITY.high.filter, 4: CSM_QUALITY.ultra.filter };
const BAND = 0.12;      // blend band at a cascade's edge, as a fraction of its half-size
const CASTER_UP = 500;  // m of casters kept above a cascade's region (an aircraft's umbra is ~100× its thickness)

// ── Pure layout maths (tests/shadows.test.mjs) ──
// Practical split scheme: split i of n between near and far, λ = 1 logarithmic, λ = 0 uniform
export function practicalSplits(near, far, n, lambda) {
    const out = [near];
    for (let i = 1; i <= n; i++) {
        const f = i / n;
        out.push(lambda * near * Math.pow(far / near, f) + (1 - lambda) * (near + (far - near) * f));
    }
    return out;
}

// the cascades of a quality level: half-size R (m), map size, texel (m), update period and phase, filter
export function cascadeLayout(q) {
    const P = CSM_QUALITY[q] || CSM_QUALITY.high;
    const R = practicalSplits(P.near, P.far, P.n, P.lambda).slice(1);
    let staggered = 0;
    return R.map((r, k) => {
        const size = P.size[k] || P.size[P.size.length - 1], every = P.every[k] || 1;
        // cascades on the same period take turns (the far two on ultra: one each frame)
        const phase = every > 1 ? staggered++ % every : 0;
        return { R: r, size, texel: (2 * r) / size, every, phase, filter: P.filter[k] };
    });
}

// Light-space axes for a sun direction s (unit, toward the sun): x = up × s, y = s × x — the orientation three's
// shadow camera takes when it looks from the light down at its target with up = +y, so a centre snapped on these
// axes is snapped on the shadow map's texel grid
export function lightBasis(s, ox, oy) {
    ox.set(0, 1, 0).cross(s);
    if (ox.lengthSq() < 1e-8) ox.set(1, 0, 0);
    ox.normalize();
    oy.crossVectors(s, ox);
    return ox;
}

// A point's light-space coordinates snapped to a texel grid: out = (u, v, w) with u, v multiples of texel
export function snapToTexel(p, ox, oy, s, texel, out) {
    out.x = Math.round(p.dot(ox) / texel) * texel;
    out.y = Math.round(p.dot(oy) / texel) * texel;
    out.z = p.dot(s);
    return out;
}

// How far ahead of the camera, along its view, a cascade of half-size R is centred: on the focus (the player's
// jet) when it's in front and within reach; otherwise half the box ahead for the finest cascade, and three quarters
// for the others (the finer ones already cover the ground round the camera); never more than the box
export function cascadeAhead(R, focusAlong, focusDist, first = true) {
    const lo = (first ? 0.5 : 0.75) * R;
    if (!(focusAlong > 0) || focusDist > 2 * R) return lo;
    return Math.min(Math.max(focusAlong, 0.5 * R), R);
}

// ═══════════════════════════════════════════════════════════════
// Shaders
// Shared uniform data (typed arrays: UniformsUtils.clone keeps them by reference, so one write reaches every
// material): CSM.info = (1 while the world scene renders, penumbra per metre of blocker height, -, debug tint),
// CSM.data = per cascade (texel m, depth range m, blend band uv, depth bias m)
export const CSM = {
    info: new Float32Array([0, SUN_TAN_RADIUS, 0, 0]),
    data: new Float32Array(CSM_MAX * 4),
    // the terrain's shadow on the sun (terrainshadow.js): texture of (shadow top height, occluder distance) and
    // (x0, z0, 1 / span, on)
    terrainTex: null,
    terrainInfo: new Float32Array([0, 0, 1, 0]),
};
// the terrain-shadow grid's texture (terrainshadow.js fills it): made here, before any material copies the uniform
export const TERRAIN_SHADOW = { N: 512, cell: 100 };
{
    const N = TERRAIN_SHADOW.N, t = new THREE.DataTexture(new Uint16Array(N * N * 2), N, N, THREE.RGFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    CSM.terrainTex = t;
}
// The terrain's shadow at a world point (1 lit): below the shadow top, in shadow; the sun's disc (csmInfo.y: its
// angular radius) softens it over the occluder's distance either side, never sharper than the grid allows (.w).
// Also for custom shaders (the sea): declare nothing else, include after csmInfo is declared or use TERRAIN_SHADOW_GLSL.
export const TERRAIN_SHADOW_FN = /* glsl */`
    float terrainSunShadow( vec3 wp ) {
        if ( csmTerrainInfo.w <= 0.0 ) return 1.0;
        vec2 uv = ( wp.xz - csmTerrainInfo.xy ) * csmTerrainInfo.z;
        if ( uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0 ) return 1.0;
        vec2 t = texture2D( csmTerrain, uv ).rg; // shadow top (m), distance to what casts it (m)
        float pw = max( t.y * csmInfo.y, csmTerrainInfo.w );
        float edge = smoothstep( 0.0, 0.03, min( min( uv.x, uv.y ), min( 1.0 - uv.x, 1.0 - uv.y ) ) );
        return mix( 1.0, smoothstep( t.x - pw, t.x + pw, wp.y ), edge );
    }`;
// for a custom shader: the uniforms and the function (add CSM_UNIFORMS() to its uniforms)
export const TERRAIN_SHADOW_GLSL = /* glsl */`
    uniform highp sampler2D csmTerrain;
    uniform vec4 csmTerrainInfo, csmInfo;
    ${TERRAIN_SHADOW_FN}`;
export const CSM_UNIFORMS = () => ({ csmInfo: { value: CSM.info }, csmData: { value: CSM.data }, csmTerrain: { value: CSM.terrainTex }, csmTerrainInfo: { value: CSM.terrainInfo } });

// filter code per cascade, by the cascade count the program was compiled with
function cascadeBlock(k) {
    const pick = [1, 2, 3, 4].filter(n => n > k).map(n => `${n === k + 1 ? '#if' : '#elif'} NUM_DIR_LIGHT_SHADOWS == ${n}\n\t\t\tconst int csmF${k} = ${CSM_FILTERS[n][k]};`).join('\n') + '\n\t\t#endif';
    return /* glsl */`
    #if NUM_DIR_LIGHT_SHADOWS > ${k}
    if ( left > 0.0 ) {
        ${pick}
        vec3 c = vDirectionalShadowCoord[ ${k} ].xyz;
        vec4 d = csmData[ ${k} ];
        float e = min( min( c.x, c.y ), min( 1.0 - c.x, 1.0 - c.y ) );
        float w = smoothstep( 0.0, d.z, e ) * smoothstep( 0.0, 0.01, c.z ) * smoothstep( 0.0, 0.01, 1.0 - c.z );
        if ( w > 0.0 ) {
            float s = csmFilter( directionalShadowMap[ ${k} ], directionalLightShadows[ ${k} ].shadowMapSize, c, g${k}, d, slope, csmF${k} );
            sum += left * w * s;
            left *= 1.0 - w;
            if ( cascade < 0.0 ) cascade = ${k}.0;
        }
    }
    #endif`;
}
function gradBlock(k) {
    return `
    #if NUM_DIR_LIGHT_SHADOWS > ${k}
    vec2 g${k} = csmGrad( vDirectionalShadowCoord[ ${k} ].xyz, directionalLightShadows[ ${k} ].shadowMapSize, csmData[ ${k} ] );
    #endif`;
}

export const CSM_GLSL = /* glsl */`
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 ) && defined( SHADOWMAP_TYPE_PCF )
    #define CSM_ON
    uniform vec4 csmInfo;
    uniform vec4 csmData[ ${CSM_MAX} ];
    uniform highp sampler2D csmTerrain;
    uniform vec4 csmTerrainInfo; // x0, z0 of the grid texture's edge, 1 / its span, narrowest penumbra (m; 0: off)
    ${TERRAIN_SHADOW_FN}
    // toward the light, in shadow-map depth (the reversed buffer has the light at 1)
    #ifdef USE_REVERSED_DEPTH_BUFFER
        #define CSM_UP( z, dz ) ( ( z ) + ( dz ) )
    #else
        #define CSM_UP( z, dz ) ( ( z ) - ( dz ) )
    #endif
    // receiver-plane depth gradient d(depth)/d(uv) from screen derivatives, clamped (it's garbage across edges)
    vec2 csmGrad( vec3 c, vec2 size, vec4 d ) {
        vec3 dx = dFdx( c ), dy = dFdy( c );
        float det = dx.x * dy.y - dx.y * dy.x;
        vec2 g = abs( det ) > 1e-12 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
        float gmax = 6.0 * d.x * size.x / d.y; // a slope of 6 texels of depth per texel
        float gl = length( g );
        return gl > gmax ? g * ( gmax / gl ) : g;
    }
    // one bilinear compare tap at an offset (uv) from the receiver, its depth moved along the receiver's plane
    float csmTap( sampler2DShadow m, vec2 uv, vec2 off, float z, vec2 g ) {
        return texture( m, vec3( uv + off, z + dot( off, g ) ) );
    }
    // 3×3 and 5×5 tents from 4 and 9 bilinear taps (Castaño 2013): smooth and without noise
    float csmPCF3( sampler2DShadow m, vec2 size, vec2 uv, float z, vec2 g ) {
        vec2 p = uv * size, b = floor( p + 0.5 ), st = p + 0.5 - b;
        vec2 base = ( b - 0.5 ) / size - uv, px = 1.0 / size;
        vec2 w0 = 3.0 - 2.0 * st, w1 = 1.0 + 2.0 * st;
        vec2 o0 = ( ( 2.0 - st ) / w0 - 1.0 ) * px + base, o1 = ( st / w1 + 1.0 ) * px + base;
        return ( w0.x * w0.y * csmTap( m, uv, vec2( o0.x, o0.y ), z, g ) + w1.x * w0.y * csmTap( m, uv, vec2( o1.x, o0.y ), z, g )
               + w0.x * w1.y * csmTap( m, uv, vec2( o0.x, o1.y ), z, g ) + w1.x * w1.y * csmTap( m, uv, vec2( o1.x, o1.y ), z, g ) ) / 16.0;
    }
    float csmPCF5( sampler2DShadow m, vec2 size, vec2 uv, float z, vec2 g ) {
        vec2 p = uv * size, b = floor( p + 0.5 ), st = p + 0.5 - b;
        vec2 base = ( b - 0.5 ) / size - uv, px = 1.0 / size;
        vec2 w0 = 4.0 - 3.0 * st, w1 = vec2( 7.0 ), w2 = 1.0 + 3.0 * st;
        vec2 o0 = ( ( 3.0 - 2.0 * st ) / w0 - 2.0 ) * px + base, o1 = ( ( 3.0 + st ) / w1 ) * px + base, o2 = ( st / w2 + 2.0 ) * px + base;
        float s = w0.x * w0.y * csmTap( m, uv, vec2( o0.x, o0.y ), z, g ) + w1.x * w0.y * csmTap( m, uv, vec2( o1.x, o0.y ), z, g ) + w2.x * w0.y * csmTap( m, uv, vec2( o2.x, o0.y ), z, g )
                + w0.x * w1.y * csmTap( m, uv, vec2( o0.x, o1.y ), z, g ) + w1.x * w1.y * csmTap( m, uv, vec2( o1.x, o1.y ), z, g ) + w2.x * w1.y * csmTap( m, uv, vec2( o2.x, o1.y ), z, g )
                + w0.x * w2.y * csmTap( m, uv, vec2( o0.x, o2.y ), z, g ) + w1.x * w2.y * csmTap( m, uv, vec2( o1.x, o2.y ), z, g ) + w2.x * w2.y * csmTap( m, uv, vec2( o2.x, o2.y ), z, g );
        return s / 144.0;
    }
    // Contact-hardening soft shadows (PCSS) on a compare-only map. Blocker search: 8 taps over the search disc at
    // four depth offsets Δ (how many taps have something more than Δ above the receiver); the mean blocker height
    // is the integral of that fraction over Δ. The penumbra is the sun's angular radius times it; then a 16-tap
    // rotated Vogel disc of bilinear taps that wide. Lit and umbra pixels stop after the first 8 taps.
    #define CSM_SEARCH 6.0
    float csmPCSS( sampler2DShadow m, vec2 size, vec2 uv, float z, vec2 g, vec4 d ) {
        vec2 px = 1.0 / size;
        float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
        // the tallest blocker the search disc can see whole: its penumbra is the disc
        float dMax = CSM_SEARCH * d.x / max( csmInfo.y, 1e-4 );
        vec4 lv = vec4( 0.012, 0.06, 0.25, 1.0 ) * dMax; // Δ levels (m)
        vec4 lz = lv / d.y;                             // ... in depth
        float b0 = 0.0;
        vec2 offs[ 8 ];
        for ( int i = 0; i < 8; i ++ ) {
            offs[ i ] = vogelDiskSample( i, 8, phi ) * CSM_SEARCH * px;
            b0 += 1.0 - csmTap( m, uv, offs[ i ], CSM_UP( z, lz.x ), g );
        }
        if ( b0 < 0.004 ) return 1.0;
        if ( b0 > 7.996 ) return 0.0;
        vec3 bk = vec3( 0.0 );
        for ( int i = 0; i < 8; i ++ ) {
            bk.x += 1.0 - csmTap( m, uv, offs[ i ], CSM_UP( z, lz.y ), g );
            bk.y += 1.0 - csmTap( m, uv, offs[ i ], CSM_UP( z, lz.z ), g );
            bk.z += 1.0 - csmTap( m, uv, offs[ i ], CSM_UP( z, lz.w ), g );
        }
        float dAvg = lv.x + ( bk.x * ( lv.y - lv.x ) + bk.y * ( lv.z - lv.y ) + bk.z * ( lv.w - lv.z ) ) / b0;
        float rad = clamp( dAvg * csmInfo.y / d.x, 1.25, CSM_SEARCH );
        float s = 0.0;
        for ( int i = 0; i < 16; i ++ ) s += csmTap( m, uv, vogelDiskSample( i, 16, phi ) * rad * px, z, g );
        return s / 16.0;
    }
    float csmFilter( sampler2DShadow m, vec2 size, vec3 c, vec2 g, vec4 d, float slope, const int f ) {
        // a small bias toward the light: the bilinear compare's own half-texel of slope, and depth quantisation
        float z = CSM_UP( c.z, ( d.w + d.x * ( 0.25 + 0.5 * slope ) ) / d.y );
        if ( f == 0 ) return csmPCF3( m, size, c.xy, z, g );
        if ( f == 1 ) return csmPCF5( m, size, c.xy, z, g );
        return csmPCSS( m, size, c.xy, z, g, d );
    }
    // the sun's shadow across the cascades (1 lit); cascade: the first one used (-1: none)
    float csmShadow( float NoL, out float cascade ) {
        float slope = clamp( sqrt( max( 1.0 - NoL * NoL, 0.0 ) ) / max( abs( NoL ), 0.08 ), 0.0, 8.0 );
        float sum = 0.0, left = 1.0;
        cascade = -1.0;
        // (derivatives first, in uniform control flow)
        ${[0, 1, 2, 3].map(gradBlock).join('')}
        ${[0, 1, 2, 3].map(cascadeBlock).join('')}
        return sum + left;
    }
#endif
`;

// tints for the cascade debug view (CSM.info[3] = 1)
const DEBUG_TINT = '( cascade < -0.5 ? vec3( 1.0 ) : cascade < 0.5 ? vec3( 1.0, 0.25, 0.25 ) : cascade < 1.5 ? vec3( 0.25, 1.0, 0.25 ) : cascade < 2.5 ? vec3( 0.3, 0.4, 1.0 ) : vec3( 1.0, 1.0, 0.2 ) )';

// Patch three's chunks (once, at import): the cascade sampler after the shadow helpers, and the sun's shadow term
// in the directional-light loop. While CSM.info.x is 0 (any scene but the world: the cockpit) every directional
// light keeps three's own shadow. Materials may #define SHADOW_FADE(s) to post-process the sun's shadow term.
export function installCascadeShader() {
    const C = THREE.ShaderChunk;
    if (C.shadowmap_pars_fragment.includes('csmShadow')) return true;
    const src = C.lights_fragment_begin;
    const start = src.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
    const end = src.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
    const line = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
    const re = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
    if (start < 0 || end < start) return false;
    let block = src.slice(start, end);
    if (!block.includes(line) || !block.includes(re)) return false; // three.js changed: keep its own shadows
    const own = line.replace('? getShadow(', '? SHADOW_FADE( getShadow(').replace(') : 1.0;', ') ) : 1.0;');
    block = block.replace(line, `
        #if ( UNROLLED_LOOP_INDEX == 0 ) && defined( CSM_ON )
            if ( csmInfo.x > 0.5 ) {
                float csmCascade;
                float csmS = ( directLight.visible && receiveShadow ) ? csmShadow( dot( geometryNormal, directLight.direction ), csmCascade ) : 1.0;
                directLight.color *= SHADOW_FADE( mix( 1.0, csmS, directionalLightShadow.shadowIntensity ) );
                // the terrain's own shadow at any range (mountains at dawn and dusk), on everything
                directLight.color *= mix( 1.0, terrainSunShadow( cameraPosition + ( vec4( geometryPosition, 0.0 ) * viewMatrix ).xyz ), directionalLightShadow.shadowIntensity );
                if ( csmInfo.w > 0.5 ) directLight.color *= ${DEBUG_TINT.replace(/cascade/g, 'csmCascade')};
            } else {
                ${own}
            }
        #elif defined( CSM_ON )
            // the other cascades carry no light of their own while the cascades are on
            if ( csmInfo.x < 0.5 ) { ${own} }
        #else
            ${own}
        #endif`)
        .replace(re, `#if ( UNROLLED_LOOP_INDEX == 0 )
            vec3 csmPre = reflectedLight.directDiffuse + reflectedLight.directSpecular;
            #endif
            #if defined( CSM_ON ) && ( UNROLLED_LOOP_INDEX > 0 ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
            if ( csmInfo.x < 0.5 )
            #endif
            ${re}
            #if ( UNROLLED_LOOP_INDEX == 0 )
            csmSun = reflectedLight.directDiffuse + reflectedLight.directSpecular - csmPre; // (the sun's own light)
            #endif`);
    C.lights_fragment_begin = '#ifndef SHADOW_FADE\n#define SHADOW_FADE( s ) ( s )\n#endif\nvec3 csmSun = vec3( 0.0 );\n#define CSM_SUN_SHARE\n' + src.slice(0, start) + block + src.slice(end);
    // An opaque pixel's alpha carries the sun's share of its light (after the haze), 1 + 0.5 × share: the post
    // passes (postfx.js) apply ambient occlusion to the rest and contact shadows to that share. (The water marks
    // itself below 0.7 and every opaque pixel stays at 1 or more, so the water's mark is untouched.)
    C.premultiplied_alpha_fragment = `#if defined( CSM_SUN_SHARE ) && defined( OPAQUE ) && defined( CSM_ON )
        if ( csmInfo.x > 0.5 ) {
            float csmL = dot( csmSun, vec3( 0.2126, 0.7152, 0.0722 ) );
            #ifdef USE_FOG
            csmL *= 1.0 - fogAmt.x;
            #endif
            gl_FragColor.a = 1.0 + 0.5 * clamp( csmL / max( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-5 ), 0.0, 1.0 );
        }
    #endif
    ` + C.premultiplied_alpha_fragment;
    C.shadowmap_pars_fragment += '\n' + CSM_GLSL;
    // the uniforms, for every built-in material with shadows (and custom ones that merge UniformsLib.lights)
    const U = CSM_UNIFORMS();
    for (const k in THREE.ShaderLib) {
        const L = THREE.ShaderLib[k];
        if (L.fragmentShader && L.fragmentShader.includes('<shadowmap_pars_fragment>')) Object.assign(L.uniforms, U);
    }
    Object.assign(THREE.UniformsLib.lights, U);
    return true;
}
export const CSM_INSTALLED = installCascadeShader();

// ═══════════════════════════════════════════════════════════════
// The cascades: lights, placement, update schedule, caster culling
const _ox = new THREE.Vector3(), _oy = new THREE.Vector3(), _dir = new THREE.Vector3(), _p = new THREE.Vector3(), _snap = new THREE.Vector3();
const _sph = new THREE.Sphere(), _box = new THREE.Box3();

export class SunShadows {
    // scene: the world scene; sun: its DirectionalLight (cascade 0, the one that carries the light);
    // groundAt(x, z): ground height (for the depth range and whether a cascade reaches the ground)
    constructor(scene, sun, groundAt = () => 0) {
        this.scene = scene;
        this.sun = sun;
        this.groundAt = groundAt;
        this.lights = [sun];
        this.cascades = [];
        this.frame = 0;
        this.quality = null;
        this.sunDir = new THREE.Vector3(0, 1, 0);
        this.lastSun = new THREE.Vector3(); // the direction the light-space axes were made for
        this.ox = new THREE.Vector3(1, 0, 0); this.oy = new THREE.Vector3(0, 0, 1);
        this.intensity = 1;
        this.casters = [0, 0, 0, 0]; // shadow casters drawn per cascade last time it rendered (stats)
        this.skipped = [0, 0, 0, 0]; // ... and skipped (too small, or held by a finer cascade)
        // CSM on only while the world scene draws (the cockpit and every other scene keep three's own shadows)
        const before = scene.onBeforeRender, after = scene.onAfterRender;
        scene.onBeforeRender = (...a) => { CSM.info[0] = this.cascades.length ? 1 : 0; before.apply(scene, a); };
        scene.onAfterRender = (...a) => { CSM.info[0] = 0; after.apply(scene, a); };
    }

    setQuality(q) {
        if (q === this.quality) return;
        this.quality = q;
        const layout = cascadeLayout(q);
        while (this.lights.length < layout.length) {
            const l = new THREE.DirectionalLight(0xffffff, 0);
            l.name = 'sunCascade' + this.lights.length;
            this.scene.add(l);
            this.scene.add(l.target);
            this.lights.push(l);
        }
        while (this.lights.length > layout.length) {
            const l = this.lights.pop();
            if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
            this.scene.remove(l); this.scene.remove(l.target);
        }
        this.cascades = layout.map((c, k) => {
            const l = this.lights[k], sh = l.shadow;
            l.castShadow = true;
            if (sh.mapSize.x !== c.size) {
                sh.mapSize.set(c.size, c.size);
                if (sh.map) { sh.map.dispose(); sh.map = null; }
            }
            sh.autoUpdate = false;
            sh.needsUpdate = true;
            sh.bias = 0;                          // (the cascade sampler biases in metres, see CSM_GLSL)
            sh.normalBias = c.texel * 0.75;       // the lookup moves off the surface by most of a texel
            sh.radius = 1;
            sh.intensity = this.intensity;
            const cam = sh.camera;
            cam.left = -c.R; cam.right = c.R; cam.top = c.R; cam.bottom = -c.R;
            cam.updateProjectionMatrix();
            this.cullBy(k);
            return { ...c, u: 0, v: 0, w: 0, back: 0, front: 0, valid: false, ground: false, at: new THREE.Vector3(1e9, 0, 0) };
        });
        for (let k = this.cascades.length; k < CSM_MAX; k++) CSM.data.fill(0, k * 4, k * 4 + 4);
    }

    // under an overcast the shadows go faint (and soft, CSM.info.y)
    setIntensity(i) {
        this.intensity = i;
        for (const l of this.lights) l.shadow.intensity = i;
    }

    // every cascade re-renders next frame (a cut, a quality change, the warm-up's first draw)
    refresh() { for (const l of this.lights) l.shadow.needsUpdate = true; for (const c of this.cascades) c.force = true; }

    // Per frame, before the world renders: place the cascades that are due and ask three to draw them.
    // focus: what the camera is looking after (the player's jet, the pilot, the photo target)
    update(camera, focus, sunDir) {
        const n = this.cascades.length;
        if (!n) return;
        this.frame++;
        const s = sunDir;
        // a new sun direction re-renders everything (the clock running moves it in small steps)
        const sunMoved = this.lastSun.distanceToSquared(s) > 1e-10;
        if (sunMoved) { this.lastSun.copy(s); this.sunDir.copy(s); lightBasis(s, this.ox, this.oy); }
        const ox = this.ox, oy = this.oy;
        camera.getWorldDirection(_dir);
        const cp = camera.position;
        const along = focus ? _p.subVectors(focus, cp).dot(_dir) : -1, fd = focus ? focus.distanceTo(cp) : 1e9;
        for (let k = 0; k < n; k++) {
            const c = this.cascades[k], L = this.lights[k], sh = L.shadow;
            const moved = c.at.distanceTo(cp) > c.R * 0.25; // a jump: re-place now
            const due = !sh.map || c.force || sunMoved || moved || (this.frame + c.phase) % c.every === 0;
            if (!due) { sh.needsUpdate = false; continue; }
            c.force = false;
            // centre: ahead of the camera along its view, snapped to the cascade's texels in light space
            const ahead = cascadeAhead(c.R, along, fd, k === 0);
            _p.copy(cp).addScaledVector(_dir, ahead);
            snapToTexel(_p, ox, oy, s, c.texel, _snap);
            const C = _p.copy(ox).multiplyScalar(_snap.x).addScaledVector(oy, _snap.y).addScaledVector(s, _snap.z);
            // depth: casters up to CASTER_UP above the region, receivers to 1.5 R below its centre; a far cascade
            // reaches down to the ground under its centre
            const g = this.groundAt(C.x, C.z);
            const sy = Math.max(s.y, 0.05);
            const toGround = Math.max(0, C.y - g) / sy;
            c.back = 1.5 * c.R + CASTER_UP;
            c.front = Math.min(Math.max(1.5 * c.R, k === n - 1 ? toGround + c.R : 0) + 150, 20000);
            c.ground = toGround + c.R < c.front; // the ground under the whole box is in its depth range
            L.target.position.copy(C);
            L.position.copy(C).addScaledVector(s, c.back);
            const cam = sh.camera, far = c.back + c.front;
            if (cam.near !== 0.5 || Math.abs(cam.far - far) > 1) { cam.near = 0.5; cam.far = far; cam.updateProjectionMatrix(); }
            c.u = _snap.x; c.v = _snap.y; c.w = _snap.z;
            c.at.copy(cp);
            c.valid = true;
            sh.needsUpdate = true;
            this.casters[k] = 0; this.skipped[k] = 0;
            const o = k * 4;
            CSM.data[o] = c.texel; CSM.data[o + 1] = far - 0.5; CSM.data[o + 2] = BAND * 0.5;
            CSM.data[o + 3] = 0.02;
        }
    }

    // Caster culling for cascade k: three tests every caster against the shadow camera's frustum; this frustum also
    // turns away casters smaller than a texel or so of this cascade, and (when the finer cascade reaches the ground)
    // casters that lie wholly inside a finer cascade's box: their shadows land where that cascade is used
    cullBy(k) {
        const f = this.lights[k].shadow.getFrustum ? this.lights[k].shadow.getFrustum() : null;
        if (!f || f.csmOwner === this) return;
        f.csmOwner = this;
        const self = this, L = this.lights[k];
        f.intersectsObject = function (o) {
            let bs;
            if (o.boundingSphere !== undefined) { if (o.boundingSphere === null) o.computeBoundingSphere(); bs = o.boundingSphere; }
            else { const g = o.geometry; if (g.boundingSphere === null) g.computeBoundingSphere(); bs = g.boundingSphere; }
            _sph.copy(bs).applyMatrix4(o.matrixWorld);
            const kk = self.lights.indexOf(L);
            if (kk > 0 && !self.wantCaster(kk, _sph)) { self.skipped[kk]++; return false; }
            let hit = this.intersectsSphere(_sph);
            // a big caster that carries a tight box of its own (geometry.userData.shadowBox: a forest tile) is tested
            // with it too, the sphere being far too loose for a cascade's thin slab. (Only on request: other code keeps
            // spheres current, or makes them huge on purpose, and leaves boxes stale.)
            if (hit && kk >= 0 && o.geometry.userData.shadowBox && o.geometry.boundingBox && _sph.radius > self.cascades[kk].R) {
                hit = this.intersectsBox(_box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
            }
            if (hit && kk >= 0) self.casters[kk]++;
            return hit;
        };
    }

    // should cascade k draw a caster with this world bounding sphere?
    wantCaster(k, sph) {
        const c = this.cascades[k];
        if (!c) return true;
        const r = sph.radius;
        if (r < c.texel) return false; // smaller than two texels across: no shadow worth a draw
        const pc = sph.center, u = pc.dot(this.ox), v = pc.dot(this.oy), w = pc.dot(this.sunDir);
        for (let j = 0; j < k; j++) {
            const f = this.cascades[j];
            if (!f.valid || !f.ground) continue;
            const inner = f.R * (1 - BAND - 0.1) - r;
            if (inner <= 0) continue;
            if (Math.abs(u - f.u) < inner && Math.abs(v - f.v) < inner && w + r < f.w + f.back && w - r > f.w - f.front) return false;
        }
        return true;
    }

    // light-space corners of each cascade's box (debug / tests)
    describe() {
        return this.cascades.map((c, k) => ({ k, R: c.R, texel: +c.texel.toFixed(4), every: c.every, filter: c.filter, u: c.u, v: c.v, back: c.back, front: c.front, ground: c.ground, casters: this.casters[k], skipped: this.skipped[k] }));
    }
}
