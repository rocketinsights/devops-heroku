const AWS = require('aws-sdk');
const Heroku = require('heroku-client');

const accessKeyId = process.env['AWS_ACCESS_KEY_ID'];
const secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'];
const heroku = new Heroku({ token: process.env['HEROKU_API_TOKEN'] });

AWS.config.update({
  accessKeyId,
  secretAccessKey,
  region: 'us-east-1'
});

const route53 = new AWS.Route53();

run().catch(err => console.log(err));

async function run() {
  const appName = process.env['HEROKU_APP_NAME']; // Heroku automatically makes your app name available in postdeploy.js
  const hostName = `${appName}.yourdomain.com`;

  // Asign new domain in Heroku for your app
  heroku.post(`/apps/${appName}/domains`, {
    body: {
      hostname: hostName,
      sni_endpoint: null // Not needed since we'll have Heroku manage this for us
    }
  }).then(app => {
    const newCname = app.cname;

    // Turns on automatic certificate management
    heroku.post(`/apps/${appName}/acm`).then(async (appAcm) => {
      const res = await route53.listHostedZones().promise();
      const zoneId = res.HostedZones.find(zone => zone.Name === 'yourdomain.com.').Id; // Find the hosted zone for your domain in Route 53

      // Create new CNAME in Route 53
      const changeRes = await route53.changeResourceRecordSets({
        HostedZoneId: zoneId,
        ChangeBatch: {
          Changes: [{ 
            Action: 'CREATE',
            ResourceRecordSet: {
              Name: hostName,
              Type: 'CNAME',
              TTL: 60, // 1 minute
              ResourceRecords: [{ Value: newCname }] // domain from Heroku
            }
          }]
        }
      }).promise();
      console.log(changeRes);
    });
  });
}