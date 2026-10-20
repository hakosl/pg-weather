# PG Weather

A map of Norway's paragliding launches, rated hour by hour for flying: wind at launch height against the launch's directions, wind just above the ridge, gusts, ridge lift, thermals and rain. Each rating lists the reasons behind it, and a site's panel compares ECMWF, ICON, GFS and MEPS side by side.

Star a site in its panel to keep it on the Favorites screen, which then opens first with each favorite's day hour by hour. Favorites are kept in the browser's local storage.

Live at **https://hakosl.github.io/pg-weather/**. Every push to `main` runs the tests and redeploys (`.github/workflows/deploy.yml`).

Every morning at 07:07 Oslo time, `.github/workflows/check-sites.yml` rates today and the next two days for the site ids it lists, and sends a push notification through [ntfy](https://ntfy.sh) when at least two models rate a site soarable for more than two hours in a row. Subscribe to the topic in the `NTFY_TOPIC` repository secret in the ntfy app. To change the sites, edit the ids in the workflow; a failed run shows up as GitHub's usual failed-workflow email. GitHub turns off schedules in public repositories after 60 days without a commit; re-enable it from the Actions tab.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests, including real forecasts from October 2026 as fixtures
npm run build    # static site in dist/
npm run check -- 9616 9654   # rates today and the next two days for these site ids
```

## Data

- **Sites**: `src/data/sites.json`, built by `npm run sites` from [Paragliding Earth](https://www.paraglidingearth.com) (all Norwegian launches). Paragliding Earth doesn't allow browser requests, so the list is bundled. Rebuilding takes about two minutes.
- **Launch facing**: from Paragliding Earth's direction ratings where the site has them, otherwise from terrain: the downhill direction across a 600 m ring of elevation samples from Kartverket's 1 m terrain model (Open-Meteo's 90 m model for Svalbard, which Kartverket doesn't cover). Sites get flagged when the terrain facing is unclear (summits, flat ground), when the ratings and terrain disagree, and when the listed altitude doesn't match the terrain at the pin.
- **Forecasts**: [Open-Meteo](https://open-meteo.com), fetched straight from the browser (no key, no server). The free tier allows 600 requests a minute, 5,000 an hour and 10,000 a day per IP address, and each site costs about 4 because of the upper-air variables. To stay inside that:
  - each site's five days come in one request (Open-Meteo charges the same for up to 14 days);
  - responses are cached in the browser's IndexedDB for 2 hours, so reloads and day switches cost nothing;
  - with favorites saved, the app opens on them and fetches only them until you open the map;
  - the map rates at most the 100 sites nearest the centre, with one model;
  - a site's panel fetches each model separately, so the map's model comes from the cache;
  - on the per-minute limit, the map retries after a minute.

## How an hour is rated

- **Launch wind**: the model's wind interpolated to launch height from its pressure levels. MEPS has no pressure levels in Open-Meteo, so it uses MEPS's 10 m wind, labelled "near ground".
- **Direction**: the Paragliding Earth rating for the wind's sector (2 good, 1 marginal), or within 30°/55° of the terrain facing. More than 100° off counts as from behind.
- **Wind above launch**: the strongest wind within 500 m above launch.
- **Gusts**: the model's 10 m gusts. Low gusts are ignored, and the gust factor only counts above 6 m/s.
- **Ridge lift**: 3–7 m/s blowing onto the slope, on a site with at least 100 m of drop nearby.
- **Thermals**: a parcel 1 K warmer than the ground rises along the dry adiabat until it meets the model's temperature profile, and the cloud base comes from the dew-point spread. Strength is the convective velocity w*, from how hard the ground heats the air and how deep the thermals go. The heating is the model's own surface heat flux for ICON and GFS, and 30% of the sunshine for ECMWF, which has no heat flux in Open-Meteo. The expected climb is w* less 1 m/s of glider sink: use it to rank hours, not as a promise.

All thresholds are in `LIMITS` (`src/analysis/rating.ts`) and in the map's legend. Treat the ratings as a starting point: a coarse model doesn't see the ridge, so check a live station before launching.
