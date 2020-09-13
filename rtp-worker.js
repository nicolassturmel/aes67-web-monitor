
var stats = require('./statistics')
var dgram = require('dgram'); 

var inter_packet_stats = new stats()
var delay_stats = new stats()
var rms = [new stats(), new stats()]
const { parentPort , workerData } = require('worker_threads')

console.log(workerData)

let timeOffset = 0n

let interval = 0.05,
    sampleRate = 48000,
    bytePerSample = 4,
    bytePerSampleStream = 3,
    channels = 2

  let buffer = [
    new Buffer.alloc(interval*sampleRate* bytePerSample * channels),
    new Buffer.alloc(interval*sampleRate* bytePerSample * channels)
  ]

  console.log(buffer)

  let currentBuffer = 0
  let currentPos = 0
  let tic = 0 

  var client = null

var getRtp = (params) => {
    console.log(params)
    let madd = params.maddress
    let port = params.port
    let host = params.host
    let offset = params.offset || 0
    client = dgram.createSocket({ type: "udp4", reuseAddr: true });
  
    client.on('listening', function () {
        console.log('UDP Client listening on ' + madd + ":" + port);
        client.setBroadcast(true)
        client.setMulticastTTL(128); 
        client.addMembership(madd,host);
    });
  
    let lastSeq = 0
    let lastTime = BigInt(0)
    let tc = 0
    let Tdiff = 0
    let max = 0
    let min = Number.POSITIVE_INFINITY
  
    client.on('message', function (message, remote) {   
        //console.log(".")
        let v = message.readInt8(0)
        let pt = message.readInt8(1)
        let seq = message.readUInt16BE(2)
        let ts = (message.readUInt32BE(4) - offset)%Math.pow(2,32)
        let ssrc = message.readUInt32BE(8)
  
        // inter packet time
        let time = process.hrtime.bigint()
        let diff = Number(time - lastTime)/1000000;
        lastTime = time
  
        // computing ts
        let realTime = timeOffset + time
        let realTS = Number(realTime*48000n / 1000000000n)%Math.pow(2,32)
        let tsdiff = (realTS - ts + Math.pow(2,32))%Math.pow(2,32)
        if(tsdiff > Math.pow(2,31)) tsdiff = tsdiff - Math.pow(2,32)
        inter_packet_stats.add(diff)
        delay_stats.add(tsdiff)
  
  
        if(seq != lastSeq+1)
          console.log("Err Seq: ",seq,lastSeq)
        lastSeq = seq
        if(lastSeq == 65535) lastSeq = -1
        
  
        for(let i = 0; i < (message.length - 12)/(channels * bytePerSampleStream); i++) 
        {
          if(currentPos == interval*sampleRate)
          {
            currentPos = 0
            parentPort.postMessage({
                type: "data",
                data: {
                    buffer: buffer[currentBuffer],
                    delay: delay_stats.get(),
                    inter_packets: inter_packet_stats.get(),
                    rms: [10*Math.log10(rms[0].get(true).mean),10*Math.log10(rms[1].get(true).mean)],
                    peak: [10*Math.log10(rms[0].get(true).max),10*Math.log10(rms[1].get(true).max)],
                    peakg: [10*Math.log10(rms[0].get().max_global),10*Math.log10(rms[1].get().max_global)],
                    rtp : {
                        payload_type: pt,
                        ssrc: ssrc
                    },
                    sender : {
                        ip: remote.address,
                        port: remote.port
                    }
                }
            })
            currentBuffer = (currentBuffer+1)%2
          }
  
          //console.log(i)
          let s = Math.pow(2,31)*0.999*Math.sin(2*Math.PI*403*tic/sampleRate)
          let s1 = (message.readInt32BE(i*6+12 - 1) & 0x00FFFFFF) << 8
          let s2 = (message.readInt32BE(i*6+12 + 3 - 1) & 0x00FFFFFF) << 8
          rms[0].add((s1 / Math.pow(2,31))*(s1 / Math.pow(2,31)))
          rms[1].add((s2 / Math.pow(2,31))*(s2 / Math.pow(2,31)))
          //if(i == 0) console.log(s1)
          buffer[currentBuffer].writeInt32LE(s1,bytePerSample * channels*currentPos)
          buffer[currentBuffer].writeInt32LE(s2,bytePerSample * channels*currentPos + bytePerSample)
          currentPos += 1
          //if(currentPos == 1) buffer[currentBuffer].writeInt32LE(Math.pow(2,31)-1,0)
          tic++
        }
    });
  
    client.bind(port);
  }
  


parentPort.on("message",(t) => {
    switch(t.type) {
        case "timeOffset":
            timeOffset = t.data
            break
        case "start":
            getRtp(t.data)
            break
        case "restart":
            client.close()
            console.log(t)
            getRtp(t.data)
        case "clear":
            inter_packet_stats.clear()
            delay_stats.clear()
            rms.forEach(e => e.clear())
            break
        default:
            break;
    }
})