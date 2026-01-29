import { getAuthTables } from "better-auth/db";
import { BetterAuthOptions } from "better-auth";

// Get the default schema with no special options
const options: Partial<BetterAuthOptions> = {
  database: {
    type: "postgresql",
  } as any,
  baseURL: "http://localhost:3000",
  secret: "dev-secret",
};

const authTables = getAuthTables(options as BetterAuthOptions);

console.log("=".repeat(80));
console.log("BETTER-AUTH REQUIRED PRISMA SCHEMA");
console.log("=".repeat(80));
console.log();

// Output the Prisma schema models
for (const [key, table] of Object.entries(authTables)) {
  console.log(`// Model: ${table.modelName}`);
  console.log(`model ${table.modelName} {`);

  const fields = table.fields as any;
  
  // Always start with id
  if (fields.id) {
    console.log(`  id        String   @id @default(cuid())`);
  }

  // Add other fields
  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (fieldName === "id") continue;
    
    let fieldDef = `  ${fieldName}`;
    
    // Type mapping
    const type = fieldConfig.type as string;
    let prismaType = "";
    switch (type) {
      case "string":
        prismaType = "String";
        break;
      case "number":
        prismaType = fieldConfig.bigint ? "BigInt" : "Int";
        break;
      case "boolean":
        prismaType = "Boolean";
        break;
      case "date":
        prismaType = "DateTime";
        break;
      case "json":
        prismaType = "Json";
        break;
      default:
        prismaType = "String";
    }

    fieldDef += " ".repeat(Math.max(1, 15 - fieldName.length)) + prismaType;

    // Attributes
    const attrs = [];
    if (fieldName === "id") {
      attrs.push("@id");
      attrs.push("@default(cuid())");
    } else {
      if (fieldConfig.unique) attrs.push("@unique");
      if (fieldConfig.index) attrs.push("@index");
      if (fieldConfig.defaultValue === false) attrs.push("@default(false)");
      if (fieldConfig.defaultValue === true) attrs.push("@default(true)");
      
      if (fieldConfig.references) {
        const ref = fieldConfig.references as any;
        attrs.push(`@relation(fields: [${fieldName}], references: [${ref.field}], onDelete: ${ref.onDelete === "cascade" ? "Cascade" : ref.onDelete})`);
      }
    }

    // Required/Optional
    if (!fieldConfig.required) {
      fieldDef += "?";
    }

    if (attrs.length > 0) {
      fieldDef += " " + attrs.join(" ");
    }

    console.log(fieldDef);
  }

  console.log(`}`);
  console.log();
}

console.log("=".repeat(80));
console.log("SUMMARY OF REQUIRED MODELS AND FIELDS");
console.log("=".repeat(80));
console.log();

for (const [key, table] of Object.entries(authTables)) {
  const fields = table.fields as any;
  const fieldCount = Object.keys(fields).length;
  console.log(`${table.modelName}: ${fieldCount} fields`);
  console.log(`  Fields: ${Object.keys(fields).join(", ")}`);
}

