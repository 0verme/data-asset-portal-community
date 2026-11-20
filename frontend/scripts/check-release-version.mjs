import { assertPackageReleaseVersion, releaseMetadataForTag, resolveReleaseMetadata } from "./release-metadata.mjs";

const tagArgument = process.argv[2];
const metadata = tagArgument
  ? releaseMetadataForTag(tagArgument, process.env.GITHUB_REPOSITORY, "release-check")
  : await resolveReleaseMetadata({ env: { ...process.env, DAP_RELEASE_TAG: "" } });
const version = await assertPackageReleaseVersion(metadata.version);
console.log(`Frontend package.json and package-lock.json match latest stable Release ${version}.`);
