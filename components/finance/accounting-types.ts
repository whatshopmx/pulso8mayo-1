export interface JournalRow {
  id:string; number:number|null; status:"DRAFT"|"POSTED"; description:string; accountingDate:string;
  branchId:string|null; version:number; reversalOfId:string|null; replacementOfId:string|null;
}
export interface JournalDetail extends JournalRow {
  businessDate:string|null; sourceType:string|null; sourceId:string|null;
  createdBy:string; createdAt:string; postedBy:string|null; postedAt:string|null; postingReason:string|null;
  lines:{ accountId:string; accountCode:string; accountName:string; costCenterId:string|null;
    debitCents:number; creditCents:number; memo:string|null }[];
  totals:{debitCents:number;creditCents:number;balanced:boolean};
  related:(Pick<JournalRow,"id"|"number"|"status"|"description"|"accountingDate"|"reversalOfId"|"replacementOfId"> & {
    postingReason:string|null;postedBy:string|null;postedAt:string|null;
  })[];
}
export interface JournalList {
  items:JournalRow[];page:number;pageSize:number;hasMore:boolean;
  capabilities:{create:boolean;update:boolean;publish:boolean;reverse:boolean};
}
export interface LedgerAccount { id:string;code:string;name:string;active:boolean;postable:boolean }
export function ledgerDecimal(cents:number) {
  const value=BigInt(cents),hundred=BigInt(100);
  return `${value/hundred}.${(value%hundred).toString().padStart(2,"0")}`;
}
export function ledgerMoney(cents:number) {
  if(!Number.isSafeInteger(cents))return "Fuera de rango";
  const value=BigInt(cents),hundred=BigInt(100),fraction=(value<0?-value:value)%hundred;
  return new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"})
    .formatToParts(value/hundred===BigInt(0)&&cents<0?-0:value/hundred)
    .map(part=>part.type==="fraction"?fraction.toString().padStart(2,"0"):part.value).join("");
}
export const ledgerToday=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export async function ledgerRequest<T>(url:string,init?:RequestInit):Promise<T> {
  const response=await fetch(url,{cache:"no-store",...init});
  const body=await response.json();
  if (!response.ok || !body.success) throw new Error(body.error?.message??"No se pudo completar la solicitud. Vuelve a intentarlo.");
  return body.data;
}
