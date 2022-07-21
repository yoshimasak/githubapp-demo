function createJwtToken(appId, privateKey) {
  const header = {
    'alg': 'RS256',
    'typ': 'JWT'
  };
  const payload = {
    iss: appId,
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 60
  };

  const encodedString = Utilities.base64Encode(JSON.stringify(header)) + '.' + Utilities.base64Encode(JSON.stringify(payload));
  const sigunature = Utilities.computeRsaSha256Signature(encodedString, privateKey);

  return encodedString + '.' + Utilities.base64Encode(sigunature);
}

function sendHttpRequest(url, method, credential, payload) {
  console.info("Start sending request to " + url);

  try {
    const response = UrlFetchApp.fetch(url, {
      method: method,
      headers: {
        Authorization: `Bearer ${credential}`
      },
      payload: payload,
      muteHttpException: true
    });

    return response.getContentText();

  } catch (e) {
    console.error(e);
  }
}

function getGithubAccessToken(baseUrl, appId, installationId, privateKey) {
  const jwtToken = createJwtToken(appId, privateKey);
  const url = baseUrl + `/app/installations/${installationId}/access_tokens`;
  const response = sendHttpRequest(url, 'post', jwtToken, null);

  return JSON.parse(response).token;
}

function getReference(baseUrl, githubUser, repo, accessToken) {
  const url = baseUrl + `/repos/${githubUser}/${repo}/git/refs/heads/main`;
  const response = sendHttpRequest(url, 'get', accessToken, null);

  return JSON.parse(response);
}

function getCommit(url, accessToken) {
  const response = sendHttpRequest(url, 'get', accessToken, null);

  return JSON.parse(response).tree.sha;
}

function createBlob(baseUrl, githubUser, repo, accessToken, content) {
  const url = baseUrl + `/repos/${githubUser}/${repo}/git/blobs`;
  const payload = {
    "content": content,
    "encoding": "base64"
  };

  const response = sendHttpRequest(url, 'post', accessToken, JSON.stringify(payload));

  return JSON.parse(response).sha;
}

function createTree(baseUrl, githubUser, repo, accessToken, fileName, baseTree, blob) {
  const url = baseUrl + `/repos/${githubUser}/${repo}/git/trees`;
  const payload = {
    "base_tree": baseTree,
    "tree": [
      {
        "path": "manifests/" + fileName,
        "mode": "100644",
        "type": "blob",
        "sha": blob
      }
    ]
  };

  const response = sendHttpRequest(url, 'post', accessToken, JSON.stringify(payload));

  return JSON.parse(response).sha;
}

function createCommit(baseUrl, githubUser, repo, accessToken, parent, tree) {
  const url = baseUrl + `/repos/${githubUser}/${repo}/git/commits`;
  var date = new Date();
  date.setSeconds(date.getSeconds() + 10);
  const payload = {
    "message": "GAS test",
    "author": {
      "name": "test",
      "email": "test",
      "date": Utilities.formatDate(date, "JST", "yyyy-MM-dd'T'HH:mm:ss'Z'")
    },
    "parents": [
      parent
    ],
    "tree": tree
  };

  const response = sendHttpRequest(url, 'post', accessToken, JSON.stringify(payload));

  return JSON.parse(response).sha;
}

function updateReference(baseUrl, githubUser, repo, accessToken, commit) {
  const url = baseUrl + `/repos/${githubUser}/${repo}/git/refs/heads/main`;
  const payload = {
    "sha": commit,
    "force": false
  };

  sendHttpRequest(url, 'patch', accessToken, JSON.stringify(payload));
}

function getFormValue(e) {
  var itemResponses = e.response.getItemResponses();
  return itemResponses;
}

function createGCSManifest(name, region) {
  var templateFile = DriveApp.getFileById("19m7C7wJizORmjp87JmfuaKR0Zj-U7WsR");
  var content = templateFile.getBlob().getDataAsString("utf-8");

  content = content.replace("bucket-name", name);
  content = content.replace("region", region);
  console.log(content);

  return Utilities.base64Encode(content);
}

function main(e) {
  console.log("Start executing.");

  const formResponse = getFormValue(e);
  const bucketName = formResponse[0].getResponse();
  const bucketRegion = formResponse[1].getResponse();
  const content = createGCSManifest(bucketName, bucketRegion);
  const fileName = "gcs-" + bucketName + "-manifest.yaml";

  const baseUrl = "https://api.github.com";
  const properties = PropertiesService.getScriptProperties();
  const appId = properties.getProperty('appId');
  const installationId = properties.getProperty('installationId');
  const privateKey = properties.getProperty('privateKey').replace(/\\n/g, "\n");
  const githubUser = properties.getProperty('githubUser');
  const githubRepo = properties.getProperty('githubRepo');

  const accessToken = getGithubAccessToken(baseUrl, appId, installationId, `${privateKey}`);
  const reference = getReference(baseUrl, githubUser, githubRepo, accessToken);
  const parentCommit = getCommit(reference.object.url, accessToken);
  const newBlob = createBlob(baseUrl, githubUser, githubRepo, accessToken, content);
  const newTree = createTree(baseUrl, githubUser, githubRepo, accessToken, fileName, parentCommit, newBlob);
  const newCommit = createCommit(baseUrl, githubUser, githubRepo, accessToken, reference.object.sha, newTree);
  updateReference(baseUrl, githubUser, githubRepo, accessToken, newCommit);
}
