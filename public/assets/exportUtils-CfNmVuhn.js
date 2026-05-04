const b=(n,l)=>{if(n.length===0){alert("No data to export");return}const c=Object.keys(n[0]);let r=c.join(",")+`
`;n.forEach(u=>{const d=c.map(a=>{const o=u[a];if(o==null)return"";const t=String(o);return t.includes(",")||t.includes('"')||t.includes(`
`)?`"${t.replace(/"/g,'""')}"`:t});r+=d.join(",")+`
`});const s=new Blob([r],{type:"text/csv;charset=utf-8;"}),e=document.createElement("a"),i=URL.createObjectURL(s);e.setAttribute("href",i),e.setAttribute("download",`${l}_${new Date().toISOString().split("T")[0]}.csv`),e.style.visibility="hidden",document.body.appendChild(e),e.click(),document.body.removeChild(e)};export{b as e};
