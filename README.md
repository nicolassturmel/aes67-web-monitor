# aes67-web-monitor

AES67-web-monitor is a micro service that allows you to monitor your LAN AES67 streams on your browser. This means ... on your phone too !

# How To

First get code
```
git clone https://github.com/nicolassturmel/aes67-web-monitor
cd aes67-web-monitor
```

the dependencies
```
nom i
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

# Help needed

- Improve stability
- Accomodate to more than two channels
- Have different metering (LUFS...)
