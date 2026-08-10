-- Intelligence Permission Tables
-- Run against Fast_Core database

-- 1. Permission Groups (custom groups for batch assignment)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'IntelPermissionGroup')
CREATE TABLE [dbo].[IntelPermissionGroup] (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Name        NVARCHAR(200)   NOT NULL,
    Description NVARCHAR(500)   NULL,
    IsActive    BIT             NOT NULL DEFAULT 1,
    CreatedBy   INT             NOT NULL,
    CreatedAt   DATETIME2       NOT NULL DEFAULT GETDATE(),
    UpdatedAt   DATETIME2       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_IntelPermGroup_Name UNIQUE (Name)
);

-- 2. Group Members (link groups to users by email)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'IntelPermissionGroupMember')
CREATE TABLE [dbo].[IntelPermissionGroupMember] (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    GroupId     INT             NOT NULL REFERENCES IntelPermissionGroup(Id) ON DELETE CASCADE,
    UserEmail   NVARCHAR(200)   NOT NULL,
    AddedBy     INT             NOT NULL,
    AddedAt     DATETIME2       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_IntelPermGroupMember UNIQUE (GroupId, UserEmail)
);

-- 3. Brand Permissions (grant brand access to user or group)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'IntelBrandPermission')
CREATE TABLE [dbo].[IntelBrandPermission] (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    BrandCode   NVARCHAR(10)    NOT NULL,   -- e.g., 'UNO', 'KSI'
    -- Either UserEmail OR GroupId is set (not both)
    UserEmail   NVARCHAR(200)   NULL,
    GroupId     INT             NULL REFERENCES IntelPermissionGroup(Id) ON DELETE CASCADE,
    GrantedBy   INT             NOT NULL,
    GrantedAt   DATETIME2       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT CK_IntelBrandPerm_Target CHECK (
        (UserEmail IS NOT NULL AND GroupId IS NULL) OR
        (UserEmail IS NULL AND GroupId IS NOT NULL)
    ),
    CONSTRAINT UQ_IntelBrandPerm_User UNIQUE (BrandCode, UserEmail),
    CONSTRAINT UQ_IntelBrandPerm_Group UNIQUE (BrandCode, GroupId)
);

-- Index for fast permission lookups
CREATE NONCLUSTERED INDEX IX_IntelBrandPerm_Email ON IntelBrandPermission(UserEmail) WHERE UserEmail IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_IntelBrandPerm_Group ON IntelBrandPermission(GroupId) WHERE GroupId IS NOT NULL;
