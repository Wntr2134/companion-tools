# AW-HE40 knob commands (work today with plain HTTP GET actions)

Camera: `192.168.0.42`. `8000` = no movement, and the step size is how far the value is from `8000`.

| Knob | Rotate left | Rotate right |
|---|---|---|
| Zoom | `http://192.168.0.42/cgi-bin/directctrl?zoom=-1` | `http://192.168.0.42/cgi-bin/directctrl?zoom=1` |
| Pan | `http://192.168.0.42/cgi-bin/aw_ptz?cmd=%23RPC7B008000&res=1` | `http://192.168.0.42/cgi-bin/aw_ptz?cmd=%23RPC85008000&res=1` |
| Tilt | `http://192.168.0.42/cgi-bin/aw_ptz?cmd=%23RPC80007B00&res=1` | `http://192.168.0.42/cgi-bin/aw_ptz?cmd=%23RPC80008500&res=1` |

- `7B00` / `8500` are equal ±`0500` steps. The earlier `7950` was about 34% bigger than `8500`.
- Smaller steps: `7E00` / `8200`. Bigger steps: `7600` / `8A00`.
- The stock module's "Lens - Zoom In/Out" is continuous: it starts the zoom and needs "Zoom Stop". Don't put it on a knob without a stop.
- `directctrl` is the camera's web-page endpoint. It isn't in Panasonic's published protocol, so values other than ±1 haven't been checked.
