import { execSync } from "node:child_process"

/** A git command's answer, or nothing outside a checkout or without git. */
function git(command) {
    try {
        return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
    } catch {
        return ""
    }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    images: {
        unoptimized: true,
    },
    devIndicators: false,
    // Which build this is, for Settings > About: the commit, whether there
    // were changes not yet committed (said by development builds only), and
    // when. Read by lib/build-info.ts.
    env: {
        NEXT_PUBLIC_BUILD_COMMIT: git("git rev-parse HEAD"),
        NEXT_PUBLIC_BUILD_CHANGED: git("git status --porcelain") ? "1" : "",
        NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    },
}

export default nextConfig
