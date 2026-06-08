#!/usr/bin/env bash
#set -e

nvm use 20

echo "Building Ionic app..."
npm run build

echo "Syncing Capacitor Android..."
npx cap sync android

#echo "Copying android folder to Windows..."
rm -rf /mnt/c/Personal/mobile/android
cp -r android /mnt/c/Personal/mobile/android

echo "Done!"
#echo "Android project copied to: C:\\Personal\\mobile\\android"