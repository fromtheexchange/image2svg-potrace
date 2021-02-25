docker run -v $PWD:/claudia -v $HOME/.aws:/root/.aws --rm lambci/lambda:build-nodejs12.x /bin/bash -c "\
cd /claudia
rm -rf node_modules
npm set unsafe-perm true
npm install
npm run build
npm run claudia-update
"
