import { expect, it } from "vitest";
import { EMPTY_LIBRARY_FILTERS } from "./library";
import { libraryCommandV2Schema } from "./library-command-v2";
import { libraryCommandV3Schema, classifiedTemplateSummarySchema } from "./library-v3";
const id="00000000-0000-4000-8000-000000000001";
const metadata={title:"가짜",tags:[],school:null,targetGrade:null,schoolYear:null,semester:null,assessment:null,purpose:"원문 설명"};
const old={action:"create",requestId:id,metadata,recipe:{filters:EMPTY_LIBRARY_FILTERS,scopes:[],excludedOccurrenceKeys:[],scopeStatus:"unconfirmed"},criteria:null,previewHash:"a".repeat(64)};
it("keeps strict legacy requests and explicit version-3 kinds independent",()=>{
  expect(libraryCommandV2Schema.safeParse(old).success).toBe(true);
  for(const templateKind of ["performance_assessment","exam_prep","mock_exam","other"]){
    const next={...old,protocolVersion:3,templateKind};expect(libraryCommandV3Schema.parse(next)).toMatchObject({templateKind,metadata:{purpose:"원문 설명"}});
    expect(libraryCommandV2Schema.safeParse(next).success).toBe(false);
  }
  for(const templateKind of [null,undefined,"guess"]){expect(libraryCommandV3Schema.safeParse({...old,protocolVersion:3,templateKind}).success).toBe(false);}
  expect(libraryCommandV3Schema.safeParse({...old,protocolVersion:3,templateKind:"other",answer:"private"}).success).toBe(false);
  expect(libraryCommandV3Schema.safeParse({...old,protocolVersion:3,templateKind:"other",metadata:{...metadata,templateKind:"other"}}).success).toBe(false);
});
it("allows a legacy null on existing metadata but requires the response field",()=>{
  expect(libraryCommandV3Schema.safeParse({action:"metadata",requestId:id,protocolVersion:3,templateKind:null,templateId:id,expectedRevision:1,metadata}).success).toBe(true);
  const summary={id,revision:1,metadata,latestVersion:{id,number:1,contentHash:"a".repeat(64),scopeStatus:"unconfirmed",scopeCount:0,sourceCount:0,includedCount:0,sourceVersionId:null,datasetId:null,createdAt:"2026-10-02T00:00:00Z",hasCriteria:false}};
  expect(classifiedTemplateSummarySchema.safeParse(summary).success).toBe(false);expect(classifiedTemplateSummarySchema.parse({...summary,templateKind:null}).templateKind).toBeNull();
});
