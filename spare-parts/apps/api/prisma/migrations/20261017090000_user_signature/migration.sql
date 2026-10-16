-- Each user can keep a picture of their signature; it is printed on the PR in their signature box.
ALTER TABLE "users" ADD COLUMN "signature_key" TEXT;
