WITH existing AS (
  UPDATE users
     SET login_method='email_code', role='admin', password_hash=NULL,
         password_change_required=false, active=true, updated_at=now()
   WHERE lower(email)='adminit@aisa.com.gt'
   RETURNING id
)
INSERT INTO users (open_id,name,email,login_method,role,password_hash,password_change_required,active)
SELECT 'email:adminit@aisa.com.gt','Administrador inicial','adminit@aisa.com.gt','email_code','admin',NULL,false,true
WHERE NOT EXISTS (SELECT 1 FROM existing)
ON CONFLICT (open_id) DO UPDATE SET email=EXCLUDED.email,login_method='email_code',role='admin',password_hash=NULL,password_change_required=false,active=true,updated_at=now();
