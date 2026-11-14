## Smart Lights: Philips Hue, Grid Connect and Magic Home

Control Hue lights (through the Hue Bridge) and Grid Connect bulbs and plugs from Companion keys, over your own network. Nothing gets re-paired.

Light keys: **tap** = on / off, **hold** = full brightness.

**Home page:** the settings have a *download it* link for a ready-made D200X page of your lights. Import it with Import / Export → Import → Buttons.

### Hue
1. Press the round button on top of the Hue Bridge.
2. Within 30 seconds, tick **Pair now** and **Save** (or press a **PAIR HUE** key).
3. Your lights, rooms and scenes appear in the presets.

### Grid Connect
1. Type your Grid Connect app **email** and **password**, leave **Country code** as 61 (Australia), tick **Fetch my devices** and **Save**. It only signs in when you tick this (Grid Connect locks sign-in for 15 minutes after a few wrong tries).
2. The module signs in once, fills in the **Grid Connect devices** box with each device's ID and key, then talks to the devices directly on your Wi-Fi.
3. The log should say *Grid Connect: found N devices*. If the sign-in fails, the connection turns red and the log says why.
4. Fetch again (**Fetch my devices**, or a **FETCH GRID CON** key) after adding a device, or after removing one and adding it again.

### Magic Home LED strips
Found on your network by themselves the first time (leave the list blank), then listed as *Name, IP address*: rename them there. No account needed. Colour keys are under **LED strips: colours**.

If a Grid Connect device isn't found on the network, add a line `ip : 192.168.x.x` under it in the box.

The Grid Connect sign-in is unofficial. If it stops working, you can still paste the device list by hand (see the setup guide).
