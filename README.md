# aes67-web-monitor

AES67-web-monitor is a micro service that allows you to monitor your LAN AES67 streams on your browser. This means ... on your phone too !

# How To

First get code
```
git clone https://github.com/nicolassturmel/aes67-web-monitor
cd aes67-web-monitor
```

then the dependencies
```
npm i
```

Then just run
```
sudo node --experimental-worker server.js
```

Once on the webpage, choose an interface to discover from and wait for SAP to do its magic

### Why root ? 
The PTP ports are bellow 1024 and require root privileges to be openned

### What port is the webserver ?
The webserver is on port 8067

### What about the RTP indicator ?
This indicator has 3 parts, left, center and right.

- Left shows the delay, narrow means a tight delay (packet arrives when it should), wide means a high delay. Mean in black, local max in green absolute max in red. If black is narrow and green is wide, this means a high delay variance.
- Right give the same information on inter packet time (time between packet processing)
- Center is just a color indicator. Black: no stream, green: ok, orange: uncertain, red: outside AES67 specs

So:
- symmetrical narrow streams are typically local, fpga generated, streams
- asymmetrical, wide on the left, are streams with a clock offset 
etc...


# Help needed

- Improve stability
- Accomodate to more than two channels
- Have different metering (LUFS...)

# Credits

The web pcm player is code originaly from https://github.com/samirkumardas/pcm-player then tweaked for realtime 
