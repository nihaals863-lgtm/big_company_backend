import { Request, Response } from 'express';
import prisma, { withRetry } from '../utils/prisma';
import { generateToken, hashPassword, comparePassword } from '../utils/auth';


export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, phone, pin, role, first_name, last_name, business_name, shop_name, company_name } = req.body;

    // Determine role from URL if not provided
    let targetuser_role = role;
    if (!targetuser_role) {
      if (req.baseUrl.includes('store')) targetuser_role = 'consumer';
      else if (req.baseUrl.includes('retailer')) targetuser_role = 'retailer';
      else if (req.baseUrl.includes('wholesaler')) targetuser_role = 'wholesaler';
    }

    // Check existing user
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: email || undefined },
          { phone: phone || undefined }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = password ? await hashPassword(password) : undefined;
    const hashedPin = pin ? await hashPassword(pin) : undefined;

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        password: hashedPassword,
        pin: hashedPin, // Store pin (hashed)
        role: targetuser_role,
        name: first_name ? `${first_name} ${last_name || ''}`.trim() : (business_name || company_name || shop_name),
        updatedAt: new Date()
      }
    });

    // Create Profile
    if (targetuser_role === 'consumer') {
      await prisma.consumerProfile.create({
        data: {
          userId: user.id
        }
      });
    } else if (targetuser_role === 'retailer') {
      await prisma.retailerProfile.create({
        data: {
          userId: user.id,
          shopName: shop_name || business_name || 'My Shop',
          address: req.body.address
        }
      });
    } else if (targetuser_role === 'wholesaler') {
      await prisma.wholesalerProfile.create({
        data: {
          userId: user.id,
          companyName: company_name || 'My Company',
          address: req.body.address
        }
      });
    }

    const token = generateToken({ id: user.id, role: user.role });

    res.json({
      success: true,
      access_token: token,
      user_id: user.id,
      message: 'Registration successful'
    });

  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password, phone, pin } = req.body;
    console.log('Login attempt:', { email, phone, role: req.body.role, baseUrl: req.baseUrl });

    let targetuser_role = req.body.role;
    if (!targetuser_role) {
      if (req.baseUrl.includes('store')) targetuser_role = 'consumer';
      else if (req.baseUrl.includes('retailer')) targetuser_role = 'retailer';
      else if (req.baseUrl.includes('wholesaler')) targetuser_role = 'wholesaler';
      else if (req.baseUrl.includes('employee')) targetuser_role = 'employee';
      else if (req.baseUrl.includes('admin')) targetuser_role = 'admin';
    }
    console.log('Determined role:', targetuser_role);

    // Find User with retry for connection issues
    const user = await withRetry(() => prisma.user.findFirst({
      where: {
        OR: [
          { email: email || undefined },
          { phone: phone || undefined }
        ],
        role: targetuser_role // Ensure role matches
      },
      include: {
        consumerProfile: true,
        retailerProfile: true,
        wholesalerProfile: true,
        employeeProfile: true
      }
    }));


    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials or role' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ error: 'Account is deactivated. Please contact support.' });
    }

    // Verify Password or PIN
    let valid = false;
    if (targetuser_role === 'consumer') {
      if (user.pin && pin && await comparePassword(pin, user.pin)) valid = true;
      else if (user.password && password && await comparePassword(password, user.password)) valid = true;
    } else {
      if (user.password && await comparePassword(password, user.password)) valid = true;
    }

    if (!valid) {
      // Fallback for "demo" usage - if strict auth fails, check for mocked credentials?
      // No, I'm building a real backend. Validation must pass.
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken({ id: user.id, role: user.role });

    // Format Response
    const responseData: any = {
      success: true,
      access_token: token,
    };

    if (targetuser_role === 'consumer') {
      responseData.customer = {
        id: user.id,
        email: user.email,
        phone: user.phone,
        first_name: user.name?.split(' ')[0],
        last_name: user.name?.split(' ').slice(1).join(' '),
        ...user.consumerProfile
      };
    } else if (targetuser_role === 'retailer') {
      responseData.retailer = {
        id: user.id,
        email: user.email,
        phone: user.phone,
        shop_name: user.retailerProfile?.shopName,
        name: user.name,
        ...user.retailerProfile
      };
    } else if (targetuser_role === 'wholesaler') {
      responseData.wholesaler = {
        id: user.id,
        email: user.email,
        phone: user.phone,
        company_name: user.wholesalerProfile?.companyName,
        name: user.name,
        ...user.wholesalerProfile
      };
    } else if (targetuser_role === 'employee') {
      responseData.employee = {
        id: user.id,
        email: user.email,
        phone: user.phone,
        name: user.name,
        ...user.employeeProfile
      };
    } else if (targetuser_role === 'admin') {
      responseData.admin = {
        id: user.id,
        email: user.email,
        name: user.name
      };
    }

    res.json(responseData);

  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

export const updatePassword = async (req: any, res: Response) => {
  try {
    const { old_password, new_password } = req.body;
    const userId = req.user.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await comparePassword(old_password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    const hashedPassword = await hashPassword(new_password);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updatePin = async (req: any, res: Response) => {
  try {
    const { old_pin, new_pin } = req.body;
    const userId = req.user.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.pin) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await comparePassword(old_pin, user.pin);
    if (!isValid) {
      return res.status(400).json({ error: 'Incorrect current PIN' });
    }

    const hashedPin = await hashPassword(new_pin);
    await prisma.user.update({
      where: { id: userId },
      data: { pin: hashedPin }
    });

    res.json({ success: true, message: 'PIN updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
