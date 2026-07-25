"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Edit } from "lucide-react";
import { format } from "date-fns";

interface PersonalTabProps {
  profile: any;
  onEdit?: () => void;
  canEdit?: boolean;
}

const genderLabels: Record<string, string> = {
  MALE: "Masculino",
  FEMALE: "Femenino",
  OTHER: "Otro",
  PREFER_NOT_TO_SAY: "Prefiero no decir",
};

const maritalStatusLabels: Record<string, string> = {
  SINGLE: "Soltero(a)",
  MARRIED: "Casado(a)",
  DIVORCED: "Divorciado(a)",
  WIDOWED: "Viudo(a)",
  COMMON_LAW: "Unión Libre",
};

const bloodTypeLabels: Record<string, string> = {
  "A+": "A+",
  "A-": "A-",
  "B+": "B+",
  "B-": "B-",
  "AB+": "AB+",
  "AB-": "AB-",
  "O+": "O+",
  "O-": "O-",
};

const paymentMethodLabels: Record<string, string> = {
  BANK_TRANSFER: "Transferencia Bancaria",
  CHECK: "Cheque",
  CASH: "Efectivo",
  PAYROLL_CARD: "Tarjeta de Nómina",
};

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="text-sm font-medium">
        {value || <span className="text-muted-foreground italic">No proporcionado</span>}
      </div>
    </div>
  );
}

export function PersonalTab({ profile, onEdit, canEdit }: PersonalTabProps) {
  const address = profile.address as any;

  return (
    <div className="space-y-6">
      {/* Personal Details */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Datos Personales</CardTitle>
              <CardDescription>Información personal básica y documentos de identificación oficial.</CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <InfoField
              label="Fecha de Nacimiento"
              value={
                profile.dateOfBirth
                  ? format(new Date(profile.dateOfBirth), "d 'de' MMMM, yyyy", { locale: require("date-fns/locale").es })
                  : null
              }
            />
            <InfoField label="CURP" value={profile.curp} />
            <InfoField label="RFC" value={profile.rfc} />
            <InfoField label="NSS (Imss)" value={profile.nss} />
            <InfoField
              label="Género"
              value={profile.gender ? genderLabels[profile.gender] : null}
            />
            <InfoField
              label="Estado Civil"
              value={profile.maritalStatus ? maritalStatusLabels[profile.maritalStatus] : null}
            />
            <InfoField
              label="Tipo de Sangre"
              value={profile.bloodType ? bloodTypeLabels[profile.bloodType] : null}
            />
            <InfoField label="Nacionalidad" value={profile.nationality || "Mexicana"} />
          </div>
        </CardContent>
      </Card>

      {/* Contact Information */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Información de Contacto</CardTitle>
              <CardDescription>Correo electrónico personal, teléfono celular y domicilio.</CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <InfoField label="Correo Personal" value={profile.personalEmail} />
            <InfoField label="Teléfono Celular" value={profile.personalPhone} />
          </div>

          {address && (
            <>
              <Separator className="my-4" />
              <div className="space-y-4">
                <Label className="text-sm font-semibold">Domicilio</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="md:col-span-2">
                    <InfoField
                      label="Calle y Número"
                      value={`${address.street || ""} ${address.exteriorNumber || ""}${
                        address.interiorNumber ? ` Int. ${address.interiorNumber}` : ""
                      }`}
                    />
                  </div>
                  <InfoField label="Colonia" value={address.neighborhood} />
                  <InfoField label="Alcaldía / Municipio" value={address.city || profile.city} />
                  <InfoField label="Estado" value={address.state || profile.state} />
                  <InfoField label="Código Postal" value={address.zipCode || profile.zipCode} />
                </div>
              </div>
            </>
          )}

          {!address && (
            <div className="text-sm text-muted-foreground italic">
              No se ha registrado domicilio
            </div>
          )}
        </CardContent>
      </Card>

      {/* Emergency Contact */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Contacto de Emergencia</CardTitle>
              <CardDescription>Persona de contacto designada para casos de emergencia.</CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {profile.emergencyContactName ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <InfoField label="Nombre Completo" value={profile.emergencyContactName} />
              <InfoField label="Teléfono" value={profile.emergencyContactPhone} />
              <InfoField label="Correo Electrónico" value={profile.emergencyContactEmail} />
              <InfoField
                label="Parentesco"
                value={profile.emergencyContactRelationship}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic">
              No se ha registrado contacto de emergencia
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bank Information */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Información Bancaria</CardTitle>
              <CardDescription>Datos de la cuenta bancaria para dispersión de nómina.</CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {profile.bankName ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <InfoField label="Institución Bancaria" value={profile.bankName} />
              <InfoField label="CLABE Interbancaria" value={profile.clabe} />
              <InfoField
                label="Método de Pago"
                value={
                  profile.paymentMethod
                    ? paymentMethodLabels[profile.paymentMethod]
                    : null
                }
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic">
              No se ha registrado información bancaria
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
