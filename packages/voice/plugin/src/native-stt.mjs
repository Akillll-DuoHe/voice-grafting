// Small optional adapter for consumers of speechToText.resolve/transcribe.
// It is not a replacement implementation of the entire DSH provider registry.
export function createDshSpeechAdapter(client){
  return Object.freeze({
    resolve({audio,language='auto',providerId}={}){
      if(providerId&&providerId!=='local-voice')throw Error('This fallback only provides local-voice');
      if(!(audio instanceof Uint8Array)||audio.byteLength<46||audio.byteLength>8*1024*1024)throw Error('Expected a bounded PCM16 WAV');
      const b=Buffer.from(audio.buffer,audio.byteOffset,audio.byteLength);
      if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.toString('ascii',12,16)!=='fmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==16000||b.readUInt32LE(28)!==32000||b.readUInt16LE(32)!==2||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(4)!==b.length-8||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2)throw Error('Expected canonical 16 kHz mono PCM16 WAV');
      if(!['auto','zh'].includes(language))throw Error('This local fallback is configured for Chinese recognition');
      return {providerId:'local-voice',audio:new Uint8Array(b),language};
    },
    async transcribe(spec,signal){
      const checked=this.resolve(spec),start=performance.now();
      const result=await client.transcribe(checked.audio,{filename:'voice.wav',language:checked.language,signal});
      return {text:result.text,audioSeconds:(checked.audio.length-44)/32000,inferenceSeconds:(performance.now()-start)/1000};
    }
  });
}
