import { writeFile } from "node:fs/promises";

const sql = `WITH existing AS (\n  UPDATE users\n     SET login_method='email_code', role='admin', password_hash=NULL,\n         password_change_required=false, active=true, updated_at=now()\n   WHERE lower(email)='adminit@aisa.com.gt'\n   RETURNING id\n)\nINSERT INTO users (open_id,name,email,login_method,role,password_hash,password_change_required,active)\nSELECT 'email:adminit@aisa.com.gt','Administrador inicial','adminit@aisa.com.gt','email_code','admin',NULL,false,true\nWHERE NOT EXISTS (SELECT 1 FROM existing)\nON CONFLICT (open_id) DO UPDATE SET email=EXCLUDED.email,login_method='email_code',role='admin',password_hash=NULL,password_change_required=false,active=true,updated_at=now();\n`;
await writeFile(new URL("../database/002_local_admin.sql", import.meta.url), sql);
console.log("Seed SQL generado en database/002_local_admin.sql");
