import type { NextRequest } from "next/server";
import { z } from "zod";
import { getJournal, journalDraftSchema, journalUpdateSchema, publishDraft, reverseJournal, updateDraft } from "@/lib/services/accounting/journal-service";
import { journalError, journalJson, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";

type Params = { params: Promise<{id:string}> };
const version = z.number().int().min(1), reason = z.string().trim().min(5).max(500);
const actionSchema = z.discriminatedUnion("action",[
  z.object({action:z.literal("PUBLISH"),expectedVersion:version,reason}).strict(),
  z.object({action:z.literal("REVERSE"),expectedVersion:version,reason,accountingDate:z.iso.date(),
    replacement:journalDraftSchema.omit({source:true}).strict().optional()}).strict(),
]);
export async function GET(req:NextRequest,{params}:Params) {
  try {
    const ctx=await journalPrincipal(req,"read");
    return journalResponse(await getJournal(ctx,(await params).id));
  } catch(error) { return journalError(error); }
}
export async function PUT(req:NextRequest,{params}:Params) {
  try {
    const ctx=await journalPrincipal(req,"update");
    const data=journalUpdateSchema.omit({source:true}).strict().parse(await journalJson(req));
    return journalResponse(await updateDraft(ctx,(await params).id,data));
  } catch(error) { return journalError(error); }
}
export async function POST(req:NextRequest,{params}:Params) {
  try {
    // Authenticate before parsing; service validates the specific capability again in its transaction.
    await journalPrincipal(req,"read");
    const data=actionSchema.parse(await journalJson(req));
    const ctx=await journalPrincipal(req,data.action==="PUBLISH"?"publish":"reverse");
    const id=(await params).id;
    return journalResponse(data.action==="PUBLISH"
      ?await publishDraft(ctx,id,{expectedVersion:data.expectedVersion,reason:data.reason})
      :await reverseJournal(ctx,id,{expectedVersion:data.expectedVersion,reason:data.reason,
        accountingDate:data.accountingDate,replacement:data.replacement}));
  } catch(error) { return journalError(error); }
}
