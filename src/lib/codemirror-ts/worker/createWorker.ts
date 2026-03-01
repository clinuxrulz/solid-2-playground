// @ts-nocheck
import { getAutocompletion } from "../autocomplete/getAutocompletion";
import { getHover } from "../hover/getHover";
import { getLints } from "../lint/getLints";
import { createOrUpdateFile } from "../sync/update";
/**
 * Create a worker with `WorkerShape`, given an initializer
 * method. You might want to customize how your TypeScript
 * environment is set up, so the initializer can do all
 * of that: this then gives you an object that can be
 * passed to `Comlink.expose`.
 */
export function createWorker(_options) {
    let initialized = false;
    let env;
    let options;
    return {
        async initialize() {
            if (!initialized) {
                options = await _options;
                env = await options.env;
                initialized = true;
            }
        },
        updateFile({ path, code }) {
            if (!env)
                return;
            if (createOrUpdateFile(env, path, code)) {
                options.onFileUpdated?.(env, path, code);
            }
        },
        getLints({ path, diagnosticCodesToIgnore, }) {
            if (!env)
                return [];
            return getLints({ env, path, diagnosticCodesToIgnore });
        },
        getAutocompletion({ path, context, }) {
            if (!env)
                return null;
            return getAutocompletion({ env, path, context });
        },
        getHover({ path, pos }) {
            if (!env)
                return null;
            return getHover({ env, path, pos });
        },
        getEnv() {
            return env;
        },
    };
}
