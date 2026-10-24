import { fixEditList } from '../src/movfix';
import fs from 'fs';
const [src, dst] = process.argv.slice(2);
const buf = fs.readFileSync(src);
const f = new File([buf], src.split('/').pop()!, { type: 'video/quicktime' });
const out = await fixEditList(f);
console.log('changed', out !== f);
fs.writeFileSync(dst, Buffer.from(await out.arrayBuffer()));
