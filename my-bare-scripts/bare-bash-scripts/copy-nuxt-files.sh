#!/bin/bash
# Copy all Nuxt JS files from container to host branding directory
mkdir -p /home/bare-ai/bare-table/branding/nuxt

FILES=$(sudo docker exec bare-table-web-frontend-1 bash -c 'ls /baserow/web-frontend/.output/public/_nuxt/*.js /baserow/web-frontend/.output/public/_nuxt/*.js.map 2>/dev/null')
COUNT=0
for f in $FILES; do
  fname=$(basename "$f")
  sudo docker cp "bare-table-web-frontend-1:$f" /home/bare-ai/bare-table/branding/nuxt/"$fname" 2>/dev/null
  COUNT=$((COUNT+1))
done
echo "Copied $COUNT files to ~/bare-table/branding/nuxt/"
ls /home/bare-ai/bare-table/branding/nuxt/
