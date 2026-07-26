const { Queue } = require('bullmq');
const { connection } = require('./src/config/redis');

async function checkJob() {
  const alignmentQueue = new Queue('alignmentQueue', { connection });
  const completed = await alignmentQueue.getJobs(['completed', 'failed', 'delayed', 'active', 'waiting']);
  console.log("All jobs:");
  completed.forEach(j => {
     console.log(`Job ${j.id}: state=${j.finishedOn ? 'finished' : 'not'}, hasReturnValue=${!!j.returnvalue}, hasComparison=${!!(j.returnvalue && j.returnvalue.comparison)}, comparisonLength=${j.returnvalue && j.returnvalue.comparison ? j.returnvalue.comparison.length : 0}`);
  });
  
  process.exit(0);
}
checkJob();
