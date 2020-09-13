const WebSocket = require('ws');
const fs = require('fs');
var dgram = require('dgram'); 
var stats = require('./statistics')
const { Worker } = require('worker_threads')
const sdpTransform = require('sdp-transform');
const os = require('os');

var RtpReceivers = {}

var getInterfaces = () => {
  var netInt = os.networkInterfaces()
  let addresses = []
  Object.keys(netInt).forEach(i => {
    let ip4 = netInt[i].filter(k => k.family == "IPv4")
    if(ip4.length > 0)
      ip4.forEach(p => {
        addresses.push({
          name: i,
          ip: p.address,
          mask: p.netmask
        })
      })
  })
  return addresses
}

console.log(getInterfaces())

var launchRtpReceiver = (sdp,host,id) =>
{
  console.log(sdp.connection)
  var worker = new Worker("./rtp-worker.js")
  worker.on('online', () => { 
    worker.postMessage({
      type: "start",
      data: {
        maddress: sdp.connection.ip.split("/")[0],
        host: host,
        port: sdp.media[0].port,
        codec: "L24",
        channels: 2,
        buuferLength: 0.05,
        offset: (sdp.media && sdp.media.length>0 && sdp.media[0].mediaClk && sdp.media[0].mediaClk.mediaClockName == "direct")? sdp.media[0].mediaClk.mediaClockValue : 0
      }
    })
    console.log('One more worker') 
  })
  worker.on('message',(k) => {
    switch(k.type) {
      case "data":
        sendData(k.data)
        break
      default:
        break
    }
  })
  RtpReceivers[id] = worker
}

let wss,
    wss2;

  openSocket();

let timeOffset = 0n

function getPTP() {
  let madd = '224.0.1.129'
  let port = 319
  let host = "192.168.1.162"
  var client = dgram.createSocket({ type: "udp4", reuseAddr: true });

  client.on('listening', function () {
      console.log('UDP Client listening on ' + madd + ":" + port);
      client.setBroadcast(true)
      client.setMulticastTTL(128); 
      client.addMembership(madd,host);
  });



  client.on('message', function (message, remote) {
    let time = process.hrtime.bigint()
    if(message.readUInt8(0) == 0 && message.readUInt8(1) == 0x2) {
      let ts1 = message.readUInt8(34)
      let ts2 = message.readUInt8(35)
      let ts3 = message.readUInt8(36)
      let ts4 = message.readUInt8(37)
      let ts5 = message.readUInt8(38)
      let ts6 = message.readUInt8(39)
      let ns1 = message.readUInt8(40)
      let ns2 = message.readUInt8(41)
      let ns3 = message.readUInt8(42)
      let ns4 = message.readUInt8(43)
      let s = BigInt(ts1*Math.pow(2,48) + ts2*Math.pow(2,32) + ts3*Math.pow(2,24) + ts4*Math.pow(2,16) + ts5*Math.pow(2,8) + ts6)*1000000000n + BigInt(ns1*Math.pow(2,24) + ns2*Math.pow(2,16) + ns3*Math.pow(2,8) + ns4)
      //console.log(" - " + s)
      timeOffset =  s - time
      Object.keys(RtpReceivers).forEach(k => RtpReceivers[k].postMessage({type: "timeOffset", data: timeOffset}))
      
    }
  })


  client.bind(port);
}

let sdpCollections = []

function getSAP() {
  let madd = '239.255.255.255'
  let port = 9875
  let host = "192.168.1.162"
  var client = dgram.createSocket({ type: "udp4", reuseAddr: true });

  client.on('listening', function () {
      console.log('UDP Client listening on ' + madd + ":" + port);
      client.setBroadcast(true)
      client.setMulticastTTL(128); 
      client.addMembership(madd,host);
  });

  var removeSdp = (name) => {
     let id = sdpCollections.findIndex((k) => {k.name == name;})
     if(id >= 0) {
        sendSDP(sdpCollections[id].sdp,"remove")
       sdpCollections.splice(id,1)
     }
  }

  client.on('message', function (message, remote) {
    let sdp = sdpTransform.parse(message.toString().split("application/sdp")[1])
    let timer = setTimeout( () => {
      removeSdp(sdp.name)
    } , 45000)
    if(!sdpCollections.some(k => k.name == sdp.name)) {
      sdpCollections.push({
        sdp: sdp,
        timer: timer,
        name: sdp.name
      })
      if(sdp.name.includes("EX")) console.log(sdp,sdp.media[0].mediaClk)
      sendSDP(sdp,"update")
    }
    else {
      let item = sdpCollections.filter(k => k.name == sdp.name)[0]
      item.timer.refresh()
      item.sdp = sdp
      sendSDP(sdp,"update")
    }
    
  })


  client.bind(port);
}

var sendSDP = (SDP,action) => {
  wss2.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "streams",
          action: action,
          data: SDP
        }));
    }
  })
}

function openSocket() {
  wss = new WebSocket.Server({ port: 8080 });
  console.log('Server ready...');
  wss.on('connection', function connection(ws) {
        console.log('Socket connected. sending data...');
        ws.on("error",() => console.log("You got halted due to an error"))
        // interval = setInterval(function() {
        //   sendData();
        // }, 50);
  });
  wss2 = new WebSocket.Server({ port: 8081 });
  console.log('Server ready...');
  wss2.on('connection', function connection(ws) {
        console.log('Socket connected. sending data...');
        ws.on('message',(m) => {
          let msg = JSON.parse(m)
          console.log(m,msg)
          if(msg.type == "clear") { 
            Object.keys(RtpReceivers).forEach(k => RtpReceivers[k].postMessage({type: "clear"}))
          }
          if(msg.type == "session") {
            let sdpElem = sdpCollections.filter(e => e.name == msg.data)[0]
            if(sdpElem) {
              let params = {
                maddress: sdpElem.sdp.connection.ip.split("/")[0],
                host: "192.168.1.162",
                port: sdpElem.sdp.media[0].port,
                codec: "L24",
                channels: 2,
                buuferLength: 0.05,
                offset: (sdpElem.sdp.media && sdpElem.sdp.media.length>0 && sdpElem.sdp.media[0].mediaClk && sdpElem.sdp.media[0].mediaClk.mediaClockName == "direct")? sdpElem.sdp.media[0].mediaClk.mediaClockValue : 0        
              }
              RtpReceivers["thgssdfw"].postMessage({
                type: "restart",
                data: params
              })
            }
            
          }
        })
        ws.on("error",() => console.log("You got halted due to an error"))
        ws.send(JSON.stringify(
          {
            type: "interfaces",
            data: getInterfaces()
          }
        ))
  });
}

function sendData(struct) {
    wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
          client.send(struct.buffer);
      }
    });
    struct.buffer = null
    wss2.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: "stats",
            data: struct
          }));
      }
    });
}

getPTP()
getSAP()

let sdpstr ="v=0\n\
o=- 2 0 IN IP4 192.168.1.135\n\
s=ASIO (on OCT00317)_Horus_80858_AES 3-3\n\
c=IN IP4 239.1.1.135/15\n\
t=0 0\n\
a=clock-domain:PTPv2 0\n\
a=ts-refclk:ptp=IEEE1588-2008:00-1D-C1-FF-FE-13-05-90:0\n\
a=mediaclk:direct=0\n\
m=audio 5008 RTP/AVP 98\n\
c=IN IP4 239.1.1.135/15\n\
a=rtpmap:98 L24/48000/\n\
a=source-filter: incl IN IP4 239.1.1.135 192.168.1.135\n\
a=clock-domain:PTPv2 0\n\
a=sync-time:0\n\
a=framecount:48-768\n\
a=palign:0\n\
a=ptime:1\n\
a=ts-refclk:ptp=IEEE1588-2008:00-1D-C1-FF-FE-13-05-90:0\n\
a=mediaclk:direct=0\n\
a=recvonly\n\
a=ASIO-clock:4242\n\
"

launchRtpReceiver(sdpTransform.parse(sdpstr),"192.168.1.162","thgssdfw")
