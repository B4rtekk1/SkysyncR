UPDATE storage_quotas sq
SET used_bytes = usage.used_bytes,
    updated_at = NOW()
FROM (
    SELECT sq_inner.user_id,
           COALESCE(SUM(f.size_bytes), 0)::bigint AS used_bytes
    FROM storage_quotas sq_inner
    LEFT JOIN files f ON f.owner_id = sq_inner.user_id
    GROUP BY sq_inner.user_id
) usage
WHERE usage.user_id = sq.user_id
  AND sq.used_bytes <> usage.used_bytes;
