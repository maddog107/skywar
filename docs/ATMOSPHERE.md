# The atmosphere

One physical model of the air gives the game every colour that comes from the sky: the sky dome itself, the colour
and strength of the sun's light, the light the sky sheds on the ground, the haze over distant ground and sea, and
the clouds' lit and shaded sides. Before, each of these was a colour picked by hand per time of day.

Code: `src/atmosphere.js` (the model, in JavaScript and in GLSL), `src/weather.js` `skyPalette()` (the palette from
it), `src/world.js` (`FOG_GLSL`, the sky dome, `applySky`). Tests: `tests/atmosphere.test.mjs`.

## The model

Sebastien Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique" (EGSR 2020), on the
Earth of Bruneton & Neyret (2008). A planet of radius 6360 km under 100 km of air made of three things:

| | what it does | numbers |
|---|---|---|
| molecules (Rayleigh) | scatter blue far more than red: the blue sky, the red low sun | 5.802 / 13.558 / 33.1 per Mm at 680 / 550 / 440 nm, thinning over 8 km |
| aerosol (Mie) | scatters all colours, mostly forward: the pale horizon, the glow round the sun | the weather's haze (below), a 1.5 km layer, g = 0.8, albedo 0.94 |
| ozone | absorbs orange and green on long paths: keeps the twilight zenith blue | 0.650 / 1.881 / 0.085 per Mm, in a layer 25 ± 15 km up |

The light arriving along a ray is the sun's, scattered once toward the eye at every point of the ray (dimmed on its
way in and out, and absent where the planet shadows the air: the Earth's shadow that rises in the east after
sunset), plus light scattered more than once (Hillaire's closed form: the second bounce, taken as isotropic, times
the geometric series of the rest).

The model exists twice, with the same names and steps: in JavaScript (for the palette's numbers and the tests) and
in GLSL (for the tables). `tests/atmosphere.test.mjs` checks the JavaScript against textbook values; the GLSL was
checked against the JavaScript by reading the table back in the browser (within 7 % by day and at dusk; within a
third in the planet's shadow in deep twilight, where the JavaScript's coarser multiple-scattering table shows).

## The tables

| table | size | what it holds | redrawn |
|---|---|---|---|
| column densities | 128 × 40, CPU, once | how much of each constituent stands between a point and the top of the air, by height and direction. Transmittance for any weather is `exp(-(βR·N.r + βM·N.m + βO·N.o))`, so one table serves them all | never |
| multiple scattering | 32 × 32, GPU | the light scattered more than once, by height and sun angle (stored as its logarithm, sampled densely round the terminator) | when the aerosol changes (in 2 % steps) |
| sky view | 192 × 128, GPU | for every direction round the camera, at its height: above the horizon the sky's radiance; below it the colour distant ground fades to. Rows crowd toward the horizon, where the sky changes fastest | when the sun, the air or the overcast change, or the camera's height by 5 m + 0.5 % |

The sky-view table is the only one the game's shaders read (`skyLutAt(dir)`, `SKY_LUT_GLSL`), with one texture
fetch. Nothing is drawn while nothing changes: in level flight with the clock stopped the tables cost nothing.

Below the horizon the table holds the colour that air would have if it were thick enough to hide the ground (the
light scattered along the ray, divided by the share of the background it hides), running into the horizon's own sky
colour just under the horizon. So ground at the edge of the view fades into exactly the sky behind it.

## What reads it

- **The sky dome** (`world.js` `skyMat`) draws the table, then adds what a table that coarse cannot hold: the sun's
  disc and the tight glare round it (coloured by the sun's light at the camera's height: from an aircraft the
  setting sun is brighter and less red than from the field below), the moon, the Milky Way, lightning. A grain
  finer than the display's steps keeps the smooth gradient from banding.
- **Aerial perspective** (`FOG_GLSL` / `FOG_AIR_GLSL`, every material). Between the camera and a point the air
  - *takes* light: the weather's haze, mist and ground fog exactly as before (the same law the game's eyes and
    sensors use, `weather.js` `fogTaus`), plus the molecules, which take blue first;
  - *adds* light: the table's colour for that direction, times what was taken, per colour. So haze comes in blue
    over a few kilometres and whitens as it thickens, glows toward a low sun and is cool away from it. Thick fog adds
    its own white instead (`fogWhite`).

  Built-in materials look the table up per vertex (a texture less in their fragment shaders, where the terrain was
  at the GPU's limit of 16). Custom shaders call `skyFog(col, ray, camPos)`; `skyFogAmount` and `skyFogColor` still
  work as before for shaders that mix by hand.
- **The sea** mirrors the table (`ocean.js` `skyAt`). **Particles and trails** fade to it. **The FLIR / TV picture**
  takes the haze off with it (`postfx.js` `defog`).

## The palette (`weather.js` `skyPalette`)

| value | from |
|---|---|
| sun's colour and strength | its transmittance through the weather's air (white at noon, orange-red at the horizon, gone once the ground hides it) × the exposure; dimmed and whitened by the weather's cloud |
| sky's light on the ground | the sky's irradiance from the same model: the hemisphere light (× `FILL`) and, through the dome, the environment map (`envI` = 1) |
| zenith, horizon | the model's radiances (the sea's ambient light, the canopy's reflections) |
| fog's own colour | white droplets (albedo 0.75) under that sun and sky |
| clouds, lit and shaded | the sun's light at cloud height (at dusk the clouds are still lit when the ground's light has gone red); the sky's light. Uniforms `litColor`, `shadowColor` in `clouds.js` |
| moon | the old night's light on the ground, in from 3° to 7° of sun below the horizon; it lights the night sky through the same model |

What is still set by hand, and why:

- **The air per time of day and weather** (`PALETTES`, `applyWeatherToPalette`): haze, mist and fog amounts. These
  are the game's visibility and are unchanged. The aerosol the model uses is that haze (`MIE_PER_HAZE`: the clear
  day's 32 km haze counts as an aerosol optical depth of 0.11, ordinary clear air). Bad weather makes it thicker and
  greyer (droplets instead of dry haze).
- **The exposure** (`SUN_DAY`, `TWILIGHT_K`, `TWILIGHT_OPEN`, `FILL`, `MOON_SKY`). The model gives light in units of
  the sun's irradiance above the air; the exposure turns that into the game's light units, as a camera would.
  - From 22° of sun up: whatever draws the sun's beam at its old strength (2.94), all day.
  - 6° up and lower: fixed (9; noon's is 3.8), so the beam reddens and dims into the horizon as the air makes it.
  - With the sun down: opening e-fold for every 2.2° it sinks (as fast as the zenith darkens just after sunset: the
    sky holds its brightness for ten minutes, then fades, the glow in the west faster than the sky overhead), and for
    every 1.2° once it is 5° down. A faint glow is left on the horizon at the end of nautical twilight (−12°).
  - Under an overcast with the light low it opens further, for the sky's light only, to make up for what the deck
    takes: a storm at dusk or by the moon is about as bright as a clear one, as it was.
  - `FILL` (0.7): the hemisphere light is that multiple of the sky's own irradiance, on top of the environment map
    (which carries the sky's light once already). It stands for the light the surroundings bounce back.

  These were set so that mid-grey ground is as bright as the hand-made palettes had it at the old four times.
- **Colour rendering** (`SATURATION` 1.35): the three wavelengths' radiances become display colours pushed out
  from grey, as film and cameras do. A colorimetrically exact Rayleigh sky is paler than any photograph of one.
- **The overcast**: weather puts a grey deck over part of the sky (`cover`), which lets 0.6 … 0.12 of the light
  above it through as a flat grey. The dome, the haze and the sky's light go grey and dim with it. Seen from above
  the deck, only the high cloud that comes with bad weather remains (`World.domeCover`).
- **The environment map** is baked from the dome as seen from 1000 m, whatever height the camera is at, so the
  light it gives the ground does not depend on where the last bake caught the camera.

## Costs

- Per pixel: built-in materials no texture fetch (one per vertex), one extra exponential for the molecules in
  place of two `pow`. The dome, sea and clouds one fetch.
- Per change: the sky-view pass (24,576 texels × 32 steps, plus a second march for the rows just under the
  horizon), and the 32 × 32 multiple-scattering pass when the aerosol changes.
- CPU: `skyPalette` about 0.3 ms, at most ten times a second and only while the clock runs or the weather changes;
  about 1.5 ms more when the aerosol moves to its next 2 % step.
