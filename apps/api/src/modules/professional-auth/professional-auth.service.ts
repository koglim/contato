import { randomUUID } from "node:crypto";
import { PostgresProfessionalAuthRepository } from "./professional-auth.repository.js";
import { encryptAuthMessage,generateOtp,generateSessionToken,hashOtp,hashSessionToken,OTP_TTL_SECONDS,SESSION_TTL_SECONDS } from "./professional-auth.crypto.js";
export class ProfessionalAuthService{
 constructor(private readonly repository=new PostgresProfessionalAuthRepository(),private readonly pepper=process.env.PROFESSIONAL_AUTH_PEPPER){if(!pepper)throw new Error("PROFESSIONAL_AUTH_PEPPER is required");}
 async requestChallenge(phone:string){const id=randomUUID(),otp=generateOtp(),expiresAt=new Date(Date.now()+OTP_TTL_SECONDS*1000);const reference=await this.repository.createChallenge({id,phone,codeHash:hashOtp(this.pepper!,id,otp),expiresAt,encryptedMessage:encryptAuthMessage(this.pepper!,`Seu código ContatoCerto é ${otp}. Ele expira em 5 minutos.`),provider:"evolution"});return{accepted:true,challenge_reference:reference??randomUUID(),expires_in_seconds:OTP_TTL_SECONDS};}
 async verify(reference:string,code:string){const token=generateSessionToken(),expiresAt=new Date(Date.now()+SESSION_TTL_SECONDS*1000);const result=await this.repository.verifyChallenge(reference,hashOtp(this.pepper!,reference,code),hashSessionToken(token),expiresAt);return result?{ok:true as const,session_token:token,expires_in_seconds:SESSION_TTL_SECONDS}:{ok:false as const};}
 authenticate(token:string|undefined){return token?this.repository.findSession(hashSessionToken(token)):Promise.resolve(null);} revoke(token:string|undefined){return token?this.repository.revokeSession(hashSessionToken(token)):Promise.resolve(false);}
}
