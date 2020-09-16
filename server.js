const WebSocket = require('ws');
var http = require('http')
var exp = require('express')
const fs = require('fs');
var dgram = require('dgram'); 
var stats = require('./statistics')
const { Worker } = require('worker_threads')
const sdpTransform = require('sdp-transform');
const os = require('os');
const url = require('url');

var RtpReceivers = {}
let selectedDevice = null

// Web server
// ----------

const user_app = exp();

const server = http.createServer(user_app);

user_app.use('/', exp.static(__dirname + '/html'));

server.listen(8067, () => {
  console.log(`Server started on port 8067 :)`);
});

// Mechanics
// ---------

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
  var worker = new Worker("./rtp-worker.js")
  worker.on('online', () => { 
    // worker.postMessage({
    //   type: "start",
    //   data: {
    //     maddress: sdp.connection.ip.split("/")[0],
    //     host: host,
    //     port: sdp.media[0].port,
    //     codec: "L24",
    //     channels: 2,
    //     buuferLength: 0.05,
    //     offset: (sdp.media && sdp.media.length>0 && sdp.media[0].mediaClk && sdp.media[0].mediaClk.mediaClockName == "direct")? sdp.media[0].mediaClk.mediaClockValue : 0
    //   }
    // })
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

server.on('upgrade', function upgrade(request, socket, head) {
    const pathname = url.parse(request.url).pathname;
  
    if (pathname === '/pcm') {
      wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit('connection', ws, request);
      });
    } else if (pathname === '/stats') {
      wss2.handleUpgrade(request, socket, head, function done(ws) {
        wss2.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });
openSocket();

let timeOffset = 0n

var clientPTP = null

function getPTP(host) {
  if(clientPTP) clientPTP.close()
  let madd = '224.0.1.129'
  let port = 319
  clientPTP = dgram.createSocket({ type: "udp4", reuseAddr: true });

  clientPTP.on('listening', function () {
      console.log('UDP Client listening on ' + madd + ":" + port);
      clientPTP.setBroadcast(true)
      clientPTP.setMulticastTTL(128); 
      clientPTP.addMembership(madd,host);
  });



  clientPTP.on('message', function (message, remote) {
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


  clientPTP.bind(port);
}

let sdpCollections = []
var clientSAP = null
function getSAP(host) {
  if(clientSAP) clientSAP.close()

  let madd = '239.255.255.255'
  let port = 9875
  clientSAP = dgram.createSocket({ type: "udp4", reuseAddr: true });

  clientSAP.on('listening', function () {
      console.log('UDP Client listening on ' + madd + ":" + port);
      clientSAP.setBroadcast(true)
      clientSAP.setMulticastTTL(128); 
      clientSAP.addMembership(madd,host);
  });

  var removeSdp = (name) => {
     let id = sdpCollections.findIndex((k) => {k.name == name;})
     if(id >= 0) {
        sendSDP(sdpCollections[id].sdp,"remove")
       sdpCollections.splice(id,1)
     }
  }

  clientSAP.on('message', function (message, remote) {
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
      sendSDP(sdp,"update")
    }
    else {
      let item = sdpCollections.filter(k => k.name == sdp.name)[0]
      item.timer.refresh()
      item.sdp = sdp
      sendSDP(sdp,"update")
    }
    console.log(sdp.name,sdp.media[0].rtp)
    
  })


  clientSAP.bind(port);
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

let params = null

function openSocket() {
  wss = new WebSocket.Server({ 
              noServer: true , 
              perMessageDeflate: {
              zlibDeflateOptions: {
                // See zlib defaults.
                chunkSize: 1024,
                memLevel: 7,
                level: 3
              },
              zlibInflateOptions: {
                chunkSize: 10 * 1024
              },
              // Other options settable:
              clientNoContextTakeover: true, // Defaults to negotiated value.
              serverNoContextTakeover: true, // Defaults to negotiated value.
              serverMaxWindowBits: 10, // Defaults to negotiated value.
              // Below options specified as default values.
              concurrencyLimit: 10, // Limits zlib concurrency for perf.
              threshold: 1024 // Size (in bytes) below which messages
              // should not be compressed.
            }});
  console.log('Server ready...');
  wss.on('connection', function connection(ws) {
        console.log('Socket connected. sending data...');
        ws.on("error",() => console.log("You got halted due to an error"))
        // interval = setInterval(function() {
        //   sendData();
        // }, 50);
  });
  wss2 = new WebSocket.Server({ noServer: true });
  console.log('Server ready...');
  wss2.on('connection', function connection(ws) {
        console.log('Socket connected. sending data...');
        ws.send(JSON.stringify({
          type: "params",
          data: params
        }));
        ws.on('message',(m) => {
          let msg = JSON.parse(m)
          console.log(m,msg)
          switch(msg.type) {
            case "clear":
              Object.keys(RtpReceivers).forEach(k => RtpReceivers[k].postMessage({type: "clear"}))
              break
            case "session":
              let sdpElem = sdpCollections.filter(e => e.name == msg.data)[0]
              if(sdpElem) {
                console.log(sdpElem)
                params = {
                  maddress: (sdpElem.sdp.connection ? sdpElem.sdp.connection.ip.split("/")[0] : sdpElem.sdp.media[0].connection.ip.split("/")[0]),
                  host: selectedDevice,
                  port: sdpElem.sdp.media[0].port,
                  codec: "L24",
                  channels: sdpElem.sdp.media[0].rtp[0].encoding,
                  buuferLength: 0.05,
                  offset: (sdpElem.sdp.media && sdpElem.sdp.media.length>0 && sdpElem.sdp.media[0].mediaClk && sdpElem.sdp.media[0].mediaClk.mediaClockName == "direct")? sdpElem.sdp.media[0].mediaClk.mediaClockValue : 0        
                }
                RtpReceivers["thgssdfw"].postMessage({
                  type: "restart",
                  data: params
                })
                wss2.clients.forEach(function each(client) {
                  if (client.readyState === WebSocket.OPEN) {
                      client.send(JSON.stringify({
                        type: "params",
                        data: params
                      }));
                  }
                });
              }
              break
            case "selectInterface":
              chooseInterface(msg.data)
              break
            default:
              console.log("Unprocessed " + msg.type)
              break
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

var chooseInterface = (add) => {
  sdpCollections.forEach((id) => {
      sendSDP(id.sdp,"remove")
  })
  sdpCollections = []
  getPTP(add)
  getSAP(add)
  selectedDevice = add
}

launchRtpReceiver(null,null,"thgssdfw")






