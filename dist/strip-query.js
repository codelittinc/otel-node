import { stripUserinfo } from "./url-credentials.js";
export const URL_QUERY_START = /[?#;]/;
/** `schemeless` reads a value with no scheme and no leading `/` as starting at its authority. */
export function stripQuery(url, schemeless = false) {
    // Userinfo first: a password can hold a `?` or `#`.
    const withoutUserinfo = stripUserinfo(url, schemeless);
    const cut = withoutUserinfo.search(URL_QUERY_START);
    return cut === -1 ? withoutUserinfo : withoutUserinfo.slice(0, cut);
}
