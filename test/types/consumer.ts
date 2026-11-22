import { createResponseHeaderPolicy, applyResponseHeaderPolicy, type PolicyOptions } from '@ehven/http-response-header-policy';

const options: PolicyOptions = {
  headers: { 'x-frame-options': { action: 'enforce', value: 'SAMEORIGIN' } },
};
const policy = createResponseHeaderPolicy(options);
const response: Response = policy.apply(new Response('ok'));
const headers: Headers = policy.applyHeaders([['x-test', 'yes']], { defaults: false });
applyResponseHeaderPolicy(response, { headers: { 'x-test': { action: 'remove' } } });
headers.get('x-test');
// @ts-expect-error value is mandatory for enforcement
createResponseHeaderPolicy({ headers: { 'x-test': { action: 'enforce' } } });
// @ts-expect-error skip cannot silently carry an ignored value
createResponseHeaderPolicy({ headers: { 'x-test': { action: 'skip', value: 'ignored' } } });
// @ts-expect-error misspelled options are not part of the public contract
createResponseHeaderPolicy({ default: false });
// @ts-expect-error a Request is not a Response
policy.apply(new Request('https://example.org/'));
