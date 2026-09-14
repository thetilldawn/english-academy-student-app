import { describe, expect, it } from 'vitest';
import { fixtureResponse, DATA_ORIGIN, PUBLIC_KEY, ACCESS_TOKEN } from '../../scripts/local-admin-baseline-data.mjs';
import { mockScopes, MOCK_DATASET_ID, MOCK_UNIT_IDS } from '../../scripts/local-mock-wordbooks-data.mjs';

describe('isolated mock wordbook browser fixtures',()=>{
  it('requires the explicit fixture flag, fake credentials and reviewed fake scope versions',()=>{
    const headers=new Headers({apikey:PUBLIC_KEY,authorization:'Bearer '+ACCESS_TOKEN});
    const url=DATA_ORIGIN+'/rest/v1/rpc/create_mock_wordbook_composition_v1';
    const input={p_request:{requestId:'00000000-0000-4000-8000-000000008001',title:'가짜 저장',scopes:mockScopes.slice(0,2).map(({id,version})=>({id,version}))}};
    const call=(overrides={})=>fixtureResponse({url,method:'POST',headers,body:JSON.stringify(input),mockWordbooks:true,...overrides});
    expect(call({mockWordbooks:false}).status).toBe(403);
    expect(call({headers:new Headers({apikey:PUBLIC_KEY})}).status).toBe(403);
    expect(call({body:JSON.stringify({p_request:{...input.p_request,scopes:[{...input.p_request.scopes[0],version:'f'.repeat(64)}]}})}).status).toBe(400);
    const saved=call();expect(saved.status).toBe(200);expect(saved.body).toMatchObject({datasetId:MOCK_DATASET_ID,scopeCount:2,includedEntryCount:8});
    expect(call()).toEqual(saved);
    const rows=fixtureResponse({url:DATA_ORIGIN+'/rest/v1/vocab_entries?dataset_id=eq.'+MOCK_DATASET_ID,method:'GET',headers,mockWordbooks:true});
    expect(rows.body).toHaveLength(8);expect(rows.category).toBe('mock-wordbooks-memory-only');
    const count=fixtureResponse({url:DATA_ORIGIN+'/rest/v1/vocab_entries?select=id&dataset_id=eq.'+MOCK_DATASET_ID+'&unit_id=in.('+MOCK_UNIT_IDS[0]+')',method:'HEAD',headers,mockWordbooks:true});
    expect(count.status).toBe(200);expect(count.count).toBe(4);expect(count.body).toEqual([]);
  });
});
