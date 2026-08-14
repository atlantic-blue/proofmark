/**
 * The trust layer, and the only thing here that is ever applied from a laptop.
 *
 * It has to be. The deploy role cannot create itself: it needs permissions
 * before it can grant itself any. So an administrator applies this once, and
 * from then on every change to the real stack goes through the deploy job.
 *
 *   AWS_SHARED_CREDENTIALS_FILE=~/claude/orgs/atlantic-blue/.secrets/aws.key \
 *   AWS_PROFILE=atlantic-blue-infra terraform -chdir=infra/bootstrap init
 *   ... apply
 *
 * The state for this one is local, so keep it. If it is lost, import the two
 * resources back before applying again, or Terraform will try to create a
 * bucket that is already there:
 *
 *   terraform -chdir=infra/bootstrap import aws_iam_role.deploy proofmark-deploy
 *   terraform -chdir=infra/bootstrap import aws_s3_bucket.state proofmark-tfstate-230345688874
 */
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "repository" {
  type    = string
  default = "atlantic-blue/proofmark"
}

data "aws_caller_identity" "current" {}

# Already in the account, put there by another project. Reused rather than
# duplicated, because an account may only have one provider per issuer.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_s3_bucket" "state" {
  bucket = "proofmark-tfstate-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Any workflow in this repository, and nothing outside it. A fork cannot
    # obtain a token carrying this repository's subject, so this is closed to
    # everybody else while staying tolerant of how the subject is spelled: it
    # changes with the branch, with a tag, and again when a job names an
    # environment. GitHub also now issues subjects carrying numeric identifiers
    # rather than the plain name, which a stricter pattern would not match.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.repository}:*",
        "repo:${split("/", var.repository)[0]}@*/${split("/", var.repository)[1]}@*:*",
      ]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "proofmark-deploy"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

# Broad on purpose, and scoped to this project's own names. The deploy job owns
# the whole stack, so it has to be able to create and destroy it. Everything it
# can reach is named for this project or is the state bucket it keeps.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid = "TerraformState"
    actions = [
      "s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
      "s3:GetBucketVersioning", "s3:GetBucketLocation",
    ]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }

  statement {
    sid       = "SiteBucket"
    actions   = ["s3:*"]
    resources = ["arn:aws:s3:::proofmark-site-*", "arn:aws:s3:::proofmark-site-*/*"]
  }

  statement {
    sid       = "Delivery"
    actions   = ["cloudfront:*"]
    resources = ["*"]
  }

  statement {
    sid       = "ReadItsOwnRole"
    actions   = ["iam:GetRole", "iam:ListRolePolicies", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies"]
    resources = [aws_iam_role.deploy.arn]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "proofmark-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}
