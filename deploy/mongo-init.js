// Runs only when a new, empty production volume is initialized.
const fs=require('fs');
db.getSiblingDB('tranquil_talk').createUser({
    user:fs.readFileSync('/run/secrets/mongo_app_user','utf8').trim(),
    pwd:fs.readFileSync('/run/secrets/mongo_app_password','utf8').trim(),
    roles:[{role:'readWrite',db:'tranquil_talk'}]
});
