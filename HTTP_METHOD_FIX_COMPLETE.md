# HTTP Method Fix - COMPLETE

## Problem Found

**Vibe API calls were failing with HTTP 405 (Method Not Allowed)**

The VibeRestClient was using `PATCH` method for updates, but the Vibe API only supports `PUT` for task/project updates.

## Evidence

```
[Vibe REST] API call failed: {
  endpoint: '/tasks/cb5dd5b4-895d-4ba1-b3dd-0a1b00b68b6b',
  method: 'PATCH',
  error: 'REST API error (405): '
}
```

API test showed allowed methods: `GET,HEAD,PUT,DELETE` - **NO PATCH!**

## Fix Applied

### Changed Methods from PATCH → PUT:

1. ✅ `updateTask()` - Line 280
2. ✅ `updateProject()` - Line 197
3. ✅ `bulkUpdateTasks()` - Line 303

### File Modified:

- `lib/VibeRestClient.js`

## Testing

To verify the fix is working:

1. **Make a change in Huly**:

   ```bash
   # Change any issue status in Huly UI
   ```

2. **Watch logs**:

   ```bash
   docker-compose logs -f | grep "Huly→Vibe"
   ```

3. **Expected**:
   - ✅ See "Huly→Vibe: Status update" messages
   - ✅ NO more "API call failed" errors with 405
   - ✅ Changes appear in Vibe Kanban within 30 seconds

4. **Check Vibe Kanban**:
   - Refresh the board
   - Verify status updated

## Summary

**Root Cause**: Vibe API doesn't support PATCH method (returns 405)  
**Solution**: Changed all update methods to use PUT instead  
**Status**: ✅ Fixed and deployed

---

**Fix Date**: November 6, 2025  
**Files Changed**: 1 (VibeRestClient.js)  
**Lines Changed**: 3 (method: 'PATCH' → method: 'PUT')
