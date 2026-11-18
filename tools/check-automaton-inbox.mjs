#!/usr/bin/env node
import fs from 'node:fs/promises';
const acc=JSON.parse(await fs.readFile(new URL('../automaton-outbox/email-account.json', import.meta.url),'utf8'));
const base='https://api.mail.tm';
let res=await fetch(base+'/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:acc.address,password:acc.password})});
const {token}=await res.json();
if(!token) throw new Error('login failed');
res=await fetch(base+'/messages?page=1',{headers:{Authorization:`Bearer ${token}`}});
const data=await res.json();
const msgs=(data['hydra:member']||[]).map(m=>({id:m.id,from:m.from?.address,subject:m.subject,intro:m.intro,createdAt:m.createdAt}));
console.log(JSON.stringify(msgs,null,2));
