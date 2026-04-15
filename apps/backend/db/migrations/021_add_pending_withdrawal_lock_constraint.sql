-- Enforce one in-flight withdrawal per account.
-- This hardens withdrawal idempotency and prevents duplicate execution races.

with ranked_pending as (
    select
        id,
        row_number() over (
            partition by account_id
            order by created_at desc, id desc
        ) as rn
    from rebalance_logs
    where from_protocol = 'withdrawal'
      and status = 'pending'
)
update rebalance_logs as rl
set
    status = 'failed',
  skip_reason = coalesce(rl.skip_reason, 'superseded_pending_withdrawal_lock')
from ranked_pending rp
where rl.id = rp.id
  and rp.rn > 1;

create unique index if not exists uq_rebalance_logs_pending_withdrawal
on rebalance_logs (account_id)
where from_protocol = 'withdrawal'
  and status = 'pending';
