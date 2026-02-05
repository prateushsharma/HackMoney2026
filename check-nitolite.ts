import nitrolite from "@erc7824/nitrolite";
const n: any = nitrolite;

console.log("nitrolite keys (first 120):");
console.log(Object.keys(n).sort().slice(0, 120));

console.log("\nPotential auth helpers:");
for (const k of Object.keys(n).sort()) {
  if (k.toLowerCase().includes("auth")) console.log(" -", k);
}
