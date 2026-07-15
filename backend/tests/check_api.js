const http = require('http');

const options = {
  hostname: 'localhost',
  port: 8000,
  path: '/api/job/8/result',
  method: 'GET',
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
     console.log("Total bytes:", data.length);
     try {
       const j = JSON.parse(data);
       console.log("Parsed keys:", Object.keys(j));
       if (j.result) {
          console.log("Result keys:", Object.keys(j.result));
          if (j.result.comparison) {
             console.log("Comparison length:", j.result.comparison.length);
          }
       }
     } catch(e) {
       console.log("Parse err:", e);
     }
  });
});
req.end();
