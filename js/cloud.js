// A single serialized queue plus a session generation guard prevents cross-account writes.
export function createCloudSync({client,getContext,onMerged,onStatus}) {
  let generation=0, running=false, requested=false;
  async function drain() {
    if(running) return;
    running=true;
    try {
      while(requested) {
        requested=false;
        const token=generation, context=getContext();
        if(!client || !context.userId) continue;
        onStatus('Syncing…');
        try {
          const {data,error}=await client.rpc('merge_learning_progress',{incoming:context.state,expected_user:context.userId});
          if(token!==generation || context.userId!==getContext().userId) continue;
          if(error) {onStatus('Saved on this device. Cloud sync unavailable; retry after setup or reconnection.');continue;}
          onMerged(data,context.userId);
          onStatus('Progress synced');
        } catch {
          if(token===generation) onStatus('Saved on this device. Cloud sync failed; retry when connected.');
        }
      }
    } finally {running=false;}
  }
  return {
    request(){requested=true;void drain();},
    changeSession(){generation++;requested=false;},
  };
}
