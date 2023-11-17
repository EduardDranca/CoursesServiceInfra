#!/bin/bash

if [ $# -ne 2 ]; then
    echo "Usage: $0 <aws_role> <session_name>"
    exit 1
fi

AWS_ROLE_ARN=$1
SESSION_NAME=$2

echo "Assuming role $AWS_ROLE_ARN with session name $SESSION_NAME..."
CREDS=$(awslocal sts assume-role --role-arn $AWS_ROLE_ARN --role-session-name $SESSION_NAME)

export AWS_ACCESS_KEY_ID=$(echo $CREDS | jq -r .Credentials.AccessKeyId)
export AWS_SECRET_ACCESS_KEY=$(echo $CREDS | jq -r .Credentials.SecretAccessKey)
export AWS_SESSION_TOKEN=$(echo $CREDS | jq -r .Credentials.SessionToken)

echo "Temporary credentials obtained and exported successfully."
echo "AWS_ACCESS_KEY_ID: $AWS_ACCESS_KEY_ID"
echo "AWS_SECRET_ACCESS_KEY: $AWS_SECRET_ACCESS_KEY"
echo "AWS_SESSION_TOKEN: $AWS_SESSION_TOKEN"