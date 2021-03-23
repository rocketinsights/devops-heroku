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
  const appName = process.env['HEROKU_APP_NAME']; // This is available to us in pr-predestroy too!
  const hostName = `${appName}.yourdomain.com`;

  heroku.get(`/apps/${appName}/domains/${hostName}`).then(async (app) => {
    const newCname = app.cname;

    const res = await route53.listHostedZones().promise();
    const zoneId = res.HostedZones.find(zone => zone.Name === 'yourdomain.com.').Id;

    // Destroy CNAME record in Route 53
    const changeRes = await route53.changeResourceRecordSets({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Changes: [{ 
          Action: 'DELETE',
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
}
