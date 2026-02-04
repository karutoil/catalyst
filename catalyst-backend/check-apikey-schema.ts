import { getAuthTables } from "better-auth/db";
import { apiKey } from "better-auth/plugins";

const options = {
  database: {
    type: "postgresql",
  } as any,
  baseURL: "http://localhost:3000",
  secret: "dev-secret",
  plugins: [
    apiKey({
      prefix: "catalyst",
    }),
  ],
};

const authTables = getAuthTables(options as any);

console.log("API Key table schema:");
console.log("=".repeat(80));

for (const [key, table] of Object.entries(authTables)) {
  if (table.modelName.toLowerCase().includes('key')) {
    console.log(`model ${table.modelName} {`);
    const fields = table.fields as any;
    
    for (const [fieldName, fieldConfig] of Object.entries(fields)) {
      let line = `  ${fieldName}`;
      line += " ".repeat(Math.max(1, 20 - fieldName.length));
      
      const type = (fieldConfig as any).type;
      let prismaType = "";
      switch (type) {
        case "string": prismaType = "String"; break;
        case "number": prismaType = "Int"; break;
        case "boolean": prismaType = "Boolean"; break;
        case "date": prismaType = "DateTime"; break;
        case "json": prismaType = "Json"; break;
        default: prismaType = "String";
      }
      
      line += prismaType;
      if (!(fieldConfig as any).required) line += "?";
      
      const attrs = [];
      if (fieldName === "id") {
        attrs.push("@id", "@default(cuid())");
      } else {
        if ((fieldConfig as any).unique) attrs.push("@unique");
        if ((fieldConfig as any).defaultValue !== undefined) {
          attrs.push(`@default(${(fieldConfig as any).defaultValue})`);
        }
      }
      
      if (attrs.length > 0) line += " " + attrs.join(" ");
      console.log(line);
    }
    
    console.log("  createdAt           DateTime @default(now())");
    console.log("  updatedAt           DateTime @updatedAt");
    console.log("}");
    console.log();
  }
}
