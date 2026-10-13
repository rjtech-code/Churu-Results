#!/bin/bash
cd ~/Desktop/code/Churu-Results
docker compose up -d
ngrok http --url=https://everyone-banker-alienate.ngrok-free.dev 3000 --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!
trap "kill $NGROK_PID" EXIT
echo "Server chalu ho raha hai: https://everyone-banker-alienate.ngrok-free.dev"
APP_ORIGIN=https://everyone-banker-alienate.ngrok-free.dev npm start
