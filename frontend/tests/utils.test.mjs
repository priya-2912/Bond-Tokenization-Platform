import assert from "node:assert/strict";
import { toUnits, fromUnits, parseSnapshotLines, friendlyError, chunk, isAddressLike, fmtNumber, shortAddr } from "../src/lib/utils.js";
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok  ", name); };

t("toUnits basics", () => { assert.equal(toUnits("1", 6), 1000000n); assert.equal(toUnits("1.5", 6), 1500000n); assert.equal(toUnits("0.000001", 6), 1n); assert.equal(toUnits("1000", 18), 1000n * 10n ** 18n); });
t("toUnits rejects junk", () => { for (const bad of ["", " ", "-1", "1e3", "1.2.3", "abc", "1,5", ".5", "5.", "0x10"]) assert.throws(() => toUnits(bad, 6), undefined, bad); });
t("toUnits rejects too many decimals", () => assert.throws(() => toUnits("1.1234567", 6)));
t("fromUnits roundtrip", () => { for (const [v, d] of [["0", 6], ["1", 6], ["1234.5678", 6], ["0.000001", 6], ["1000", 18], ["0.5", 18]]) assert.equal(fromUnits(toUnits(v, d), d), v); });
t("fromUnits zero decimals", () => assert.equal(fromUnits(42n, 0), "42"));
t("fromUnits negative", () => assert.equal(fromUnits(-1500000n, 6), "-1.5"));
const A = "0x" + "a".repeat(40), B = "0x" + "B".repeat(40);
t("parseSnapshotLines good", () => { const r = parseSnapshotLines(`# header\n${A} 10.5\n${B}, 3\n\n`, 18); assert.equal(r.errors.length, 0); assert.equal(r.rows.length, 2); assert.equal(r.rows[0].balance, 105n * 10n ** 17n); });
t("parseSnapshotLines errors", () => { const r = parseSnapshotLines(`0x123 5\n${A} -2\n${A} 4\n${A.toUpperCase().replace("0X","0x")} 1\n${B}\n${B} 0`, 18); assert.equal(r.rows.length, 1); assert.equal(r.errors.length, 5); });
t("isAddressLike", () => { assert.ok(isAddressLike(A)); assert.ok(!isAddressLike("0x12")); assert.ok(!isAddressLike(undefined)); });
t("friendlyError maps known reverts", () => {
  assert.match(friendlyError({ code: "ACTION_REJECTED" }), /rejected/);
  assert.match(friendlyError({ reason: "BondToken: receiver not KYC verified" }), /not KYC-whitelisted/);
  assert.match(friendlyError({ revert: { name: "AccessControlUnauthorizedAccount" }, message: "x" }), /role/);
  assert.match(friendlyError({ shortMessage: "execution reverted: BondToken: reserve ratio below 100%" }), /reserves are below 100%/);
  assert.match(friendlyError({ message: "something odd" }), /something odd/);
  assert.equal(friendlyError(null), "Unknown error.");
  assert.ok(friendlyError({ message: "x".repeat(500) }).length <= 220);
});
t("chunk", () => assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]));
t("fmt/short", () => { assert.equal(fmtNumber("1234.5"), "1,234.50"); assert.equal(shortAddr(A), "0xaaaa...aaaa"); });
console.log(`\n${n} tests passed`);
