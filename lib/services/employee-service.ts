import { db } from "@/lib/db";
import { users, employeeProfiles, employeeContracts, employeeOnboarding, onboardingSteps, salaryHistory, employeeDocuments, employeeBenefits, employeeTraining, vacationAccruals } from "@/lib/db/schema";
import { eq, and, isNull, desc, or, ilike, sql } from "drizzle-orm";
import { ApiError } from "../api/error";
import { AuditService } from "./audit-service";
import {
  decryptProfileRecord,
  encryptProfileRecord,
} from "@/lib/security/employee-cipher";

export interface EmployeeData {
  id?: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
  profilePhotoUrl?: string | null;
  image?: string | null;
  companyId: string | null;
  branchId: string | null;
  phone: string | null;
  employeeNumber?: string | null;
  department?: string | null;
  position?: string | null;
  employeeStatus?: string | null;
  isActive?: boolean | null;
  hireDate?: Date | null;
  personalEmail?: string | null;
  personalPhone?: string | null;
  city?: string | null;
  state?: string | null;
  [key: string]: unknown;
}

export interface EmployeeUpdateData {
  name?: string;
  userName?: string;
  email?: string;
  userEmail?: string;
  role?: string;
  userRole?: string;
  phone?: string;
  branchId?: string;
  image?: string;
  profilePhotoUrl?: string;
  employeeNumber?: string;
  department?: string;
  position?: string;
  employeeStatus?: string;
  isActive?: boolean;
  hireDate?: string;
  personalEmail?: string;
  personalPhone?: string;
  city?: string;
  state?: string;
  [key: string]: unknown;
}

export class EmployeeService {
  static async listEmployees(
    companyId: string,
    options: { 
      page?: number; 
      limit?: number; 
      search?: string; 
      department?: string;
      status?: string;
      branchId?: string;
    } = {}
  ) {
    const { page = 1, limit = 20, search, department, status, branchId } = options;
    const offset = (page - 1) * limit;

    // Base filters
    const filters = [
      eq(users.companyId, companyId),
      isNull(users.deletedAt)
    ];

    if (branchId) filters.push(eq(users.branchId, branchId));
    if (department) filters.push(eq(employeeProfiles.department, department));
    if (status) filters.push(eq(employeeProfiles.employeeStatus, status as any));

    // Search filter
    if (search) {
      filters.push(or(
        ilike(users.name, `%${search}%`),
        ilike(users.email, `%${search}%`),
        ilike(employeeProfiles.employeeNumber, `%${search}%`),
        ilike(employeeProfiles.curp, `%${search}%`),
        ilike(employeeProfiles.rfc, `%${search}%`),
        ilike(employeeProfiles.position, `%${search}%`)
      ) as any);
    }

    const whereClause = and(...filters);

    // Join users with employee_profiles
    const data = await db
      .select({
        id: users.id,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
        profilePhotoUrl: users.image,
        companyId: users.companyId,
        branchId: users.branchId,
        phone: users.phone,
        // Profile fields
        employeeNumber: employeeProfiles.employeeNumber,
        department: employeeProfiles.department,
        position: employeeProfiles.position,
        employeeStatus: employeeProfiles.employeeStatus,
        isActive: employeeProfiles.isActive,
        hireDate: employeeProfiles.hireDate,
        personalEmail: employeeProfiles.personalEmail,
        personalPhone: employeeProfiles.personalPhone,
        city: employeeProfiles.city,
        state: employeeProfiles.state,
      })

      .from(users)
      .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    // Count for pagination
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
      .where(whereClause);

    const total = Number(totalResult[0]?.count || 0);

    // Decrypt any encrypted PII fields on the returned rows (no-op for plaintext).
    const decryptedData = await Promise.all(
      data.map((row) => decryptProfileRecord(companyId, row as Record<string, unknown>)),
    );

    return {
      data: decryptedData,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  static async getEmployee(id: string, options: {
    companyId: string;
    includeContracts?: boolean;
    includeSalary?: boolean;
    includeOnboarding?: boolean;
    includeDocuments?: boolean;
    includeBenefits?: boolean;
    includeTraining?: boolean;
    includeVacation?: boolean;
    includeAttendance?: boolean;
  }) {
    const { companyId, includeContracts, includeSalary, includeOnboarding, includeDocuments, includeBenefits, includeTraining, includeVacation, includeAttendance } = options;

    console.log(`[EmployeeService] Fetching employee ${id} for company ${companyId}`);

    try {
      // First, get basic user data
      const userResult = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          image: users.image,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          companyId: users.companyId,
          branchId: users.branchId,
          phone: users.phone,
          whatsappPhone: users.whatsappPhone,
          deletedAt: users.deletedAt,
        })
        .from(users)
        .where(and(eq(users.id, id), eq(users.companyId, companyId), isNull(users.deletedAt)))
        .limit(1);

      if (!userResult || userResult.length === 0) {
        console.log(`[EmployeeService] User ${id} not found in company ${companyId}`);
        throw ApiError.notFound("Employee not found");
      }

      // Then get profile data separately
      const profileResult = await db
        .select({
          employeeNumber: employeeProfiles.employeeNumber,
          department: employeeProfiles.department,
          position: employeeProfiles.position,
          employeeStatus: employeeProfiles.employeeStatus,
          isActive: employeeProfiles.isActive,
          hireDate: employeeProfiles.hireDate,
          personalEmail: employeeProfiles.personalEmail,
          personalPhone: employeeProfiles.personalPhone,
          city: employeeProfiles.city,
          state: employeeProfiles.state,
          zipCode: employeeProfiles.zipCode,
          dateOfBirth: employeeProfiles.dateOfBirth,
          curp: employeeProfiles.curp,
          rfc: employeeProfiles.rfc,
          nss: employeeProfiles.nss,
          gender: employeeProfiles.gender,
          maritalStatus: employeeProfiles.maritalStatus,
          bloodType: employeeProfiles.bloodType,
          nationality: employeeProfiles.nationality,
          address: employeeProfiles.address,
          emergencyContactName: employeeProfiles.emergencyContactName,
          emergencyContactPhone: employeeProfiles.emergencyContactPhone,
          emergencyContactEmail: employeeProfiles.emergencyContactEmail,
          emergencyContactRelationship: employeeProfiles.emergencyContactRelationship,
          bankName: employeeProfiles.bankName,
          clabe: employeeProfiles.clabe,
          cardNumber: employeeProfiles.cardNumber,
          paymentMethod: employeeProfiles.paymentMethod,
          supervisorId: employeeProfiles.supervisorId,
          seniorityDate: employeeProfiles.seniorityDate,
          probationEndDate: employeeProfiles.probationEndDate,
          terminationDate: employeeProfiles.terminationDate,
          terminationReason: employeeProfiles.terminationReason,
          rehireEligible: employeeProfiles.rehireEligible,
          defaultShiftId: employeeProfiles.defaultShiftId,
          standardHoursPerWeek: employeeProfiles.standardHoursPerWeek,
          languages: employeeProfiles.languages,
          skills: employeeProfiles.skills,
          notes: employeeProfiles.notes,
          profilePhotoUrl: employeeProfiles.profilePhotoUrl,
          createdBy: employeeProfiles.createdBy,
          updatedBy: employeeProfiles.updatedBy,
        })
        .from(employeeProfiles)
        .where(eq(employeeProfiles.userId, id))
        .limit(1);

      const result = [{ ...userResult[0], ...(profileResult.length > 0 ? profileResult[0] : {}) }];

      // Decrypt any PII fields carrying the `enc::` prefix (no-op for plaintext
      // rows — see lib/security/employee-cipher.ts). Safe to apply unconditionally.
      result[0] = await decryptProfileRecord(companyId, result[0] as Record<string, unknown>) as typeof result[0];

      console.log(`[EmployeeService] Found employee, fetching related data...`);

      const employee: EmployeeData = {
        ...result[0],
        userId: result[0].id,
        userName: result[0].name ?? null,
        userEmail: result[0].email ?? null,
        userRole: result[0].role ?? null,
        address: result[0].address || {},
        languages: result[0].languages || [],
        skills: result[0].skills || [],
      };

      // Load related data if requested
      if (includeContracts) {
        console.log(`[EmployeeService] Fetching contracts...`);
        employee.contracts = await db
          .select()
          .from(employeeContracts)
          .where(and(eq(employeeContracts.userId, id), eq(employeeContracts.companyId, companyId)))
          .orderBy(desc(employeeContracts.startDate));
      }

      if (includeSalary) {
        console.log(`[EmployeeService] Fetching salary history...`);
        employee.salaryHistory = await db
          .select()
          .from(salaryHistory)
          .where(eq(salaryHistory.userId, id))
          .orderBy(desc(salaryHistory.effectiveDate));
      }

      if (includeOnboarding) {
        console.log(`[EmployeeService] Fetching onboarding...`);
        const onboarding = await db
          .select()
          .from(employeeOnboarding)
          .where(and(eq(employeeOnboarding.userId, id), eq(employeeOnboarding.companyId, companyId)))
          .limit(1);

    if (onboarding && onboarding.length > 0) {
      const onboardingData = onboarding[0] as Record<string, unknown>;
      onboardingData.steps = await db
        .select()
        .from(onboardingSteps)
        .where(eq(onboardingSteps.onboardingId, onboarding[0].id))
        .orderBy(onboardingSteps.dueDate);
      employee.onboarding = onboardingData as typeof onboarding[0];
    }
      }

      if (includeDocuments) {
        console.log(`[EmployeeService] Fetching documents...`);
        employee.documents = await db
          .select()
          .from(employeeDocuments)
          .where(and(eq(employeeDocuments.userId, id), eq(employeeDocuments.companyId, companyId)))
          .orderBy(desc(employeeDocuments.createdAt));
      }

      if (includeBenefits) {
        console.log(`[EmployeeService] Fetching benefits...`);
        employee.benefits = await db
          .select()
          .from(employeeBenefits)
          .where(and(eq(employeeBenefits.userId, id), eq(employeeBenefits.companyId, companyId)))
          .orderBy(desc(employeeBenefits.startDate));
      }

      if (includeTraining) {
        console.log(`[EmployeeService] Fetching training...`);
        employee.training = await db
          .select()
          .from(employeeTraining)
          .where(and(eq(employeeTraining.userId, id), eq(employeeTraining.companyId, companyId)))
          .orderBy(desc(employeeTraining.startDate));
      }

      if (includeVacation) {
        console.log(`[EmployeeService] Fetching vacation accruals...`);
        employee.vacationAccruals = await db
          .select()
          .from(vacationAccruals)
          .where(and(eq(vacationAccruals.userId, id), eq(vacationAccruals.companyId, companyId)))
          .orderBy(desc(vacationAccruals.periodStart));

    // Calculate totals with null safety
    const vacationData = employee.vacationAccruals as Array<{ daysBalance?: number }> || [];
    employee.totalVacationBalance = vacationData.reduce((acc: number, curr: { daysBalance?: number }) => acc + (curr.daysBalance || 0), 0);
      }

      if (includeAttendance) {
        console.log(`[EmployeeService] Fetching attendance records...`);
        // TODO: Implement attendance table and fetching logic
        // For now, return empty array until attendance system is implemented
        employee.attendance = [];
      }

      console.log(`[EmployeeService] Employee data fetched successfully`);
      return employee;
    } catch (error) {
      console.error(`[EmployeeService] Error fetching employee:`, error);
      throw error;
    }
  }

  static async updateEmployee(id: string, companyId: string, data: EmployeeUpdateData, performedBy: string) {
    // Start a transaction to update both user and profile
    return await db.transaction(async (tx) => {
      const [existingUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, id), eq(users.companyId, companyId), isNull(users.deletedAt)))
        .limit(1);

      if (!existingUser) {
        throw ApiError.notFound("Employee not found");
      }

      // 1. Update user table fields if present
      const userFields: Record<string, unknown> = {};
      const name = data.name || data.userName;
      const email = data.email || data.userEmail;
      const role = data.role || data.userRole;
      const image = data.image || data.profilePhotoUrl;

      if (name !== undefined) userFields.name = name;
      if (email !== undefined) userFields.email = email;
      if (data.phone !== undefined) userFields.phone = data.phone;
      if (role !== undefined) userFields.role = role;
      if (data.branchId !== undefined) userFields.branchId = data.branchId;
      if (image !== undefined) userFields.image = image;

      if (Object.keys(userFields).length > 0) {
        await tx.update(users)
          .set({ ...userFields, updatedAt: new Date() })
          .where(and(eq(users.id, id), eq(users.companyId, companyId)));
      }

      // 2. Update employee_profiles fields
      // Exclude user fields and metadata
      const { 
        name: _n, email: _e, phone: _p, role: _r, branchId: _b, image: _i, 
        userName: _un, userEmail: _ue, userRole: _ur, profilePhotoUrl: _ppu,
        id: _, userId: _uid, createdAt: _ca, updatedAt: _ua, ...profileFields 
      } = data;

      // Check if profile exists
      const existingProfile = await tx.select().from(employeeProfiles).where(eq(employeeProfiles.userId, id)).limit(1);

    if (existingProfile.length > 0) {
      // Filter out undefined fields to avoid overwriting with null if using partial updates
      const filteredProfileFields = Object.fromEntries(
        Object.entries(profileFields).filter(([_, v]) => v !== undefined)
      );

      // Convert hireDate string to Date if present
      if (filteredProfileFields.hireDate && typeof filteredProfileFields.hireDate === 'string') {
        filteredProfileFields.hireDate = new Date(filteredProfileFields.hireDate);
      }

      if (Object.keys(filteredProfileFields).length > 0) {
        const encryptedProfileFields = await encryptProfileRecord(companyId, filteredProfileFields);
        await tx.update(employeeProfiles)
        .set({
          ...encryptedProfileFields,
          updatedBy: performedBy,
          updatedAt: new Date()
        })
        .where(eq(employeeProfiles.userId, id));
      }
  } else {
    // Prepare values for insert, converting hireDate if needed
    const insertValues: Record<string, unknown> = {
      ...profileFields,
      userId: id,
      createdBy: performedBy,
      updatedBy: performedBy,
    };
    // Convert hireDate string to Date if present
    if (insertValues.hireDate && typeof insertValues.hireDate === 'string') {
      insertValues.hireDate = new Date(insertValues.hireDate);
    }
    await tx.insert(employeeProfiles)
    .values(
      (await encryptProfileRecord(companyId, insertValues)) as any,
    );
  }

      // 3. Audit Logging
      await AuditService.logEmployeeAction({
          userId: id,
          performedBy: performedBy,
          action: 'UPDATE',
          entityType: 'PROFILE',
          entityId: id,
          newValue: data
      });

      return this.getEmployee(id, { companyId });
    });
  }


  static async createEmployee(data: EmployeeUpdateData, performedBy: string) {
    return await db.transaction(async (tx) => {
      // 1. Create user
      const userInsertData: Record<string, unknown> = {
        name: data.userName,
        email: data.userEmail,
        role: data.userRole || 'EMPLEADO',
        companyId: data.companyId,
        branchId: data.branchId,
        phone: data.phone,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (data.userId) {
        userInsertData.id = data.userId;
      }
      const [newUser] = await tx.insert(users).values(userInsertData as any).returning();

      // 2. Create profile
      const profileInsertData: Record<string, unknown> = {
        userId: newUser.id,
        employeeNumber: data.employeeNumber,
        department: data.department,
        position: data.position,
        employeeStatus: data.employeeStatus || 'ONBOARDING',
        isActive: data.isActive !== undefined ? data.isActive : true,
        hireDate: data.hireDate ? new Date(data.hireDate) : new Date(),
        curp: data.curp,
        rfc: data.rfc,
        nss: data.nss,
        personalEmail: data.personalEmail,
        personalPhone: data.personalPhone,
        createdBy: performedBy,
        updatedBy: performedBy,
      };
      const [newProfile] = await tx.insert(employeeProfiles).values(
        (await encryptProfileRecord(data.companyId as string, profileInsertData)) as any,
      ).returning();

      const result = {
        ...newUser,
        ...newProfile,
        userId: newUser.id,
      };

      // 3. Audit Logging
      await AuditService.logEmployeeAction({
          userId: newUser.id,
          performedBy: performedBy,
          action: 'CREATE',
          entityType: 'PROFILE',
          entityId: newUser.id,
          newValue: data
      });

      return result;
    });
  }
}
