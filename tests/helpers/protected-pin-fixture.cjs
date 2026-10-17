/** Use real protected records and await the shipped async verifier in ABI fixtures. */
const crypto = require("node:crypto");
const records = new Map();
function record(pin) {
    if (!records.has(pin)) {
        const salt = crypto.randomBytes(16);
        records.set(
            pin,
            "pbkdf2-sha256$600000$" +
                salt.toString("hex") +
                "$" +
                crypto
                    .pbkdf2Sync(pin, salt, 600000, 32, "sha256")
                    .toString("hex")
        );
    }
    return records.get(pin);
}
module.exports = function protectedPinFixture(host, pin, flush, native = true) {
    Object.defineProperty(host, "crypto", {
        configurable: true,
        value: native
            ? crypto.webcrypto
            : {
                  getRandomValues: crypto.webcrypto.getRandomValues.bind(
                      crypto.webcrypto
                  ),
              },
    });
    host.parentPIN = record(pin);
    const verify = host.__ottPinSecurity.verify;
    let pending = null;
    host.__ottPinSecurity.verify = (value, stored, current, done) => {
        const operation = { current, settled: false };
        pending = operation;
        verify(value, stored, current, (matched) => {
            operation.settled = true;
            done(matched);
        });
    };
    return async function settle() {
        const started = Date.now();
        while (pending && !pending.settled && pending.current()) {
            flush();
            if (Date.now() - started > 30000)
                throw Error("Real PIN verification timed out");
            await new Promise((resolve) => setImmediate(resolve));
        }
    };
};

module.exports.record = record;
