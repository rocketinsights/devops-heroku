# Heroku Review Apps with Automated Custom Domains on Route 53

We were setting up a Next.js project for a client that handled most business logic through an external API, including authentication and cookie handling. We also transitioned the client to Heroku and their build pipeline for [review apps](https://devcenter.heroku.com/articles/github-integration-review-apps), staging, and production deploys. The client handled their domains through [AWS's Route 53](https://aws.amazon.com/route53/) DNS service. Pointing their CNAME records for staging and production to the Heroku instances was easy enough, but enabling review apps is a different story.

## Review apps

When working on feature work it's incredibly useful to be able to poke around a standalone instance of the feature branch outside of the developer's local machine. This is useful for code reviewers and stakeholders to sign off on functionality and design as well as developers to ensure their code works in a staging environment. Heroku allows for automatic creation of a review app when a pull request is opened on github. Once that pull request is merged or closed, the review app is destroyed. 

In order for our review apps to successfully share cookies and talk to the API server at `https://api.clientdomain.com`, we needed to ensure that they shared the same domain. By default, review app domains are assigned a name based off the branch name, like `http://my-great-feature.herokuapp.com`. We needed to make sure we could access this branch at `http://my-great-feature.clientdomain.com`. You can configure this in the UIs of Heroku and AWS, but doing this manually for every review app is untenable.

Furthermore, Chrome recently enacted a change where cookies cannot be shared across protocols, even if the domain is the same. Now we have to make sure that we have a secure review app at `https://my-great-feature.clientdomain.com`.

(Whichever server you're using also needs to configure you cookie to work across subdomains. That configuration will vary depending on your stack.)

## Cool backstory, show me the code

So What to do? If you're using "new" review apps, we take care of all this configuration in an [app.json](https://devcenter.heroku.com/articles/app-json-schema) at the root of your project by using the `postdeploy` and `pr-predestroy` keys. Here we specify scripts to be run once after an app is created and when the review app is destroyed.

> Note: The `postdeploy` script will be run once after _any_ app is created, including non-review apps. If the app already exists, this script will not be run on subsequent pushes.

`app.json`
```json
{
  "scripts": {
    "postdeploy": "node bin/postdeploy.js",
    "pr-predestroy": "node bin/pr-predestroy.js"
  }
}
```

### bin/postdeploy.js

If you're using Node, you'll need to install `aws-sdk` and `heroku-client` as dependencies because Heroku will prune `devDependencies` before running these scripts. You'll also need to set up your API keys in the config vars for Review Apps through the Heroku UI.

```js
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
```

Once we get into the main `run` function, Heroku makes available some other configuation variables available to us automatically, `HEROKU_APP_NAME`, `HEROKU_BRANCH`, and `HEROKU_PR_NUMBER`. We'll only make use of `HEROKU_APP_NAME`.

```js
async function run() {
  const appName = process.env['HEROKU_APP_NAME']; 
  const hostName = `${appName}.yourdomain.com`;

  // Asign new domain in Heroku for your review app
  heroku.post(`/apps/${appName}/domains`, {
    body: {
      hostname: hostName,
      sni_endpoint: null // Not needed since we'll have Heroku manage this for us
    }
  }).then(app => {
    const newCname = app.cname;

    // Turns on automatic certificate management to get SSL working
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
```

### bin/pr-predestroy.js

The configuration setup is the same as `postdeploy.js`. Since Heroku will handle destroying of our review app, we're mostly concerned with clearing the old CNAME record in Route53 so we don't have unused records piling up. 

> The same 3 Heroku-injected configuration variables that are available to us in postdeploy.js are also available in pr-predestroy. The Heroku documentation does not make that clear

```js
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
          Action: 'DELETE', // Now this is DELETE
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
```

Many thanks to the work of these people for helping document this process:
- https://medium.com/clutter-engineering/heroku-review-apps-with-custom-domains-8edfc0a2b153
- https://thecodebarbarian.com/working-aws-route-53-in-node-js.html
