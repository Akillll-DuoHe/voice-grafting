// Adapter contract example, not an active account connection.
// The caller owns recipient authorization, context, burst merging and send ledgers.
export async function handleVoiceInput({localVoice,channel,incoming,agent,mode='text'}){
  if(!await channel.authorize(incoming))return;
  const text=incoming.audio
    ?(await localVoice.transcribe(await channel.readAudio(incoming),{filename:'voice.wav'})).text
    :incoming.text;
  // Ordinary meaning and conversation context stay in DSH.
  const answer=await agent.reply(text);
  if(!channel.isCurrent(incoming))return;
  if(mode==='voice'&&channel.capabilities.audio){const media=await localVoice.synthesize(answer,{format:'wav'});if(channel.isCurrent(incoming))await channel.replyAudio(incoming,media.audio);}
  else await channel.replyText(incoming,answer);
}
